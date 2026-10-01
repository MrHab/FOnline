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
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Постобработка URP в живом клиенте: тот же кадр игровой камеры без неё и с ней.
    /// Нужен локальный сервер с DEV_API_MODE=local и персонаж в проверяемой локации:
    /// Library/PostProcessingPlayProbe/server.json ({ baseUrl, login, password, location }).
    /// Проба подменяет PostProcessData рендерера только в памяти (ассет на диске не
    /// трогает) и снимает варианты: no-data (как в игре без PostProcessData), off
    /// (данные есть, камера без поста), on (весь авторский стек RoaWorldLighting),
    /// разбор по частям (только ACES, без тонмаппинга, Neutral) и бурю выброса без
    /// поста и с ним. Кадры 1600×900 и 844×390 (телефон в ландшафте) лежат в
    /// Library/PostProcessingPlayProbe/&lt;локация&gt;/, числа — в result.txt.
    /// Проверяет, что no-data и off совпадают (off = нынешняя игра) и что с данными
    /// пост действительно доходит до кадра.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaPostProcessingPlayProbe
    {
        private const string Key = "Roa.PostProcessingPlayProbe";
        private const string Tag = "[POST PROCESSING]";
        private const string DefaultPostProcessDataPath = "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset";
        private const string RendererPath = "Assets/Settings/RoaUniversalRenderer.asset";
        private static double _next;
        private static bool _started;
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/PostProcessingPlayProbe"));

        static RoaPostProcessingPlayProbe()
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

        [MenuItem("Realm of Ashes/Освещение/Сравнить кадр без постобработки и с ней")]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Сначала выйти из Play Mode.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Сначала сохранить открытую сцену.");
            JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
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

        private sealed class PostStack
        {
            public ColorAdjustments Color;
            public Tonemapping Tonemap;
            public Vignette Vignette;
            public Bloom Bloom;
            public float Exposure, Contrast, Saturation, VignetteIntensity;
            public Color Filter;
            public TonemappingMode Mode;
            public bool BloomActive;

            public void Save()
            {
                Exposure = Color.postExposure.value; Contrast = Color.contrast.value; Saturation = Color.saturation.value;
                Filter = Color.colorFilter.value; Mode = Tonemap.mode.value; VignetteIntensity = Vignette.intensity.value;
                BloomActive = Bloom.active;
            }

            public void Restore()
            {
                Color.postExposure.Override(Exposure); Color.contrast.Override(Contrast); Color.saturation.Override(Saturation);
                Color.colorFilter.Override(Filter); Tonemap.mode.Override(Mode); Vignette.intensity.Override(VignetteIntensity);
                Bloom.active = BloomActive;
            }
        }

        private sealed class Frame
        {
            public Color32[] Pixels;
            public int Width, Height;
        }

        private static async void Audit()
        {
            var lines = new List<string>();
            string verdict;
            UniversalRendererData rendererData = null;
            PostProcessData authoredData = null;
            // Новый вариант шейдера (пост впервые) в редакторе компилируется асинхронно и рисуется заглушкой.
            bool asyncShaders = ShaderUtil.allowAsyncCompilation;
            ShaderUtil.allowAsyncCompilation = false;
            try
            {
                JObject server = JObject.Parse(File.ReadAllText(Path.Combine(Output, "server.json")));
                string expected = server.Value<string>("location") ?? string.Empty;
                string dir = Path.Combine(Output, expected);
                Directory.CreateDirectory(dir);
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

                rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
                Require(rendererData != null, "нет " + RendererPath);
                authoredData = rendererData.postProcessData;
                PostProcessData defaultData = authoredData != null ? authoredData
                    : AssetDatabase.LoadAssetAtPath<PostProcessData>(DefaultPostProcessDataPath);
                Require(defaultData != null, "нет " + DefaultPostProcessDataPath);
                UniversalAdditionalCameraData cameraData = camera.GetUniversalAdditionalCameraData();
                bool cameraPost = cameraData.renderPostProcessing;

                RoaWorldLighting lighting = bootstrap.Lighting;
                PostStack stack = WastelandStack(lighting);
                Require(stack != null, "нет объёма Wasteland Post Processing");
                stack.Save();
                RoaWorldLighting.LightingSample sample = lighting.CurrentSample;
                lines.Add("location " + location.Id + " kind '" + location.Kind + "' profile " + lighting.VisualProfileId
                    + " hour " + F(lighting.WorldHour) + " storm " + F(lighting.WeatherStorm) + " rain " + F(lighting.WeatherRain));
                lines.Add("renderer postProcessData on disk " + (authoredData != null ? authoredData.name : "null")
                    + ", camera renderPostProcessing " + cameraPost + ", hdr " + camera.allowHDR
                    + ", device " + SystemInfo.graphicsDeviceName + " / " + SystemInfo.graphicsDeviceType
                    + ", quality " + QualitySettings.names[QualitySettings.GetQualityLevel()]);
                lines.Add("authored stack: exposure x" + F(sample.Exposure) + " (" + F(stack.Exposure, "+0.000;-0.000") + " EV), contrast "
                    + F(stack.Contrast, "0.#") + ", saturation " + F(stack.Saturation, "0.#") + ", filter " + Hex(stack.Filter)
                    + ", tonemap " + stack.Mode + ", vignette " + F(stack.VignetteIntensity) + ", bloom "
                    + (stack.BloomActive ? F(stack.Bloom.intensity.value) : "off"));

                var sizes = new[] { new Vector2Int(1600, 900), new Vector2Int(844, 390) };
                var baseline = new Dictionary<int, Frame>();
                var results = new Dictionary<string, Frame>();

                // 1. Как в игре сейчас: у рендерера нет PostProcessData.
                SetData(rendererData, null);
                foreach (Vector2Int size in sizes)
                    baseline[size.x] = Shoot(camera, size, Path.Combine(dir, "no-data-" + Label(size) + ".png"));

                SetData(rendererData, defaultData);
                try
                {
                    // 2. Данные есть, камера без поста: должно совпасть с no-data.
                    cameraData.renderPostProcessing = false;
                    foreach (Vector2Int size in sizes)
                        results["off-" + size.x] = Shoot(camera, size, Path.Combine(dir, "off-" + Label(size) + ".png"));

                    cameraData.renderPostProcessing = true;
                    // 3. Весь авторский стек; на телефоне (Application.isMobilePlatform) bloom выключен.
                    results["on-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "on-desktop.png"));
                    stack.Bloom.active = false;
                    results["on-844"] = Shoot(camera, sizes[1], Path.Combine(dir, "on-mobile.png"));
                    stack.Restore();

                    // 4. Разбор: только ACES (экспозиция часа, без цветокора, виньетки и bloom).
                    stack.Color.contrast.Override(0f); stack.Color.saturation.Override(0f);
                    stack.Color.colorFilter.Override(Color.white); stack.Vignette.intensity.Override(0f); stack.Bloom.active = false;
                    results["aces-only-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "aces-only-desktop.png"));
                    stack.Restore();
                    // Авторский цветокор без тонмаппинга и с Neutral вместо ACES.
                    stack.Tonemap.mode.Override(TonemappingMode.None);
                    results["no-tonemap-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "grade-no-tonemap-desktop.png"));
                    stack.Tonemap.mode.Override(TonemappingMode.Neutral);
                    results["neutral-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "grade-neutral-desktop.png"));
                    stack.Restore();

                    // 5. Буря выброса: зелёный фильтр и виньетка — только постом.
                    lighting.SetWeather(1f, 0f);
                    lighting.RefreshWeather();
                    cameraData.renderPostProcessing = false;
                    results["storm-off-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "storm-off-desktop.png"));
                    cameraData.renderPostProcessing = true;
                    results["storm-on-1600"] = Shoot(camera, sizes[0], Path.Combine(dir, "storm-on-desktop.png"));
                    lighting.SetWeather(0f, 0f);
                    lighting.RefreshWeather();

                    foreach (Vector2Int size in sizes)
                    {
                        lines.Add("no-data " + size.x + "x" + size.y + ": " + Describe(baseline[size.x], null));
                        foreach (KeyValuePair<string, Frame> pair in results)
                        {
                            if (pair.Value.Width != size.x) continue;
                            Frame reference = pair.Key.StartsWith("storm-on", StringComparison.Ordinal)
                                ? results["storm-off-1600"] : baseline[size.x];
                            lines.Add(pair.Key.Substring(0, pair.Key.LastIndexOf('-')) + " " + size.x + "x" + size.y + ": "
                                + Describe(pair.Value, reference));
                        }
                    }

                    foreach (Vector2Int size in sizes)
                    {
                        Diff same = Compare(results["off-" + size.x], baseline[size.x]);
                        Require(same.MaxDelta <= 2, "без поста кадр с PostProcessData отличается от кадра без неё ("
                            + size.x + "): до " + same.MaxDelta + " уровней");
                        Diff post = Compare(results["on-" + size.x], results["off-" + size.x]);
                        Require(post.ChangedShare > 0.5f, "с PostProcessData пост не дошёл до кадра (" + size.x + "): изменилось "
                            + F(post.ChangedShare * 100f, "0.0") + " % пикселей");
                    }

                    // 6. Цена на GPU: 1600×900 и 1266×585 — телефон в ландшафте при devicePixelRatio 1.5
                    // (потолок шаблона WebGL для мобильных).
                    var dump = new StringBuilder();
                    foreach (Vector2Int size in new[] { new Vector2Int(1600, 900), new Vector2Int(1266, 585) })
                    {
                        cameraData.renderPostProcessing = false;
                        Dictionary<string, double> off = await GpuPasses(camera, size);
                        cameraData.renderPostProcessing = true;
                        stack.Bloom.active = false;
                        Dictionary<string, double> noBloom = await GpuPasses(camera, size);
                        stack.Restore();
                        Dictionary<string, double> on = await GpuPasses(camera, size);
                        string label = size.x + "x" + size.y;
                        lines.Add("gpu " + label + " off: " + PostPasses(off) + " || on without bloom: " + PostPasses(noBloom)
                            + " || on: " + PostPasses(on));
                        foreach (KeyValuePair<string, Dictionary<string, double>> run in new Dictionary<string, Dictionary<string, double>>
                                 { { "off", off }, { "on-no-bloom", noBloom }, { "on", on } })
                        {
                            dump.Append("== ").Append(label).Append(' ').Append(run.Key).Append('\n');
                            var keys = new List<string>(run.Value.Keys);
                            keys.Sort(StringComparer.Ordinal);
                            foreach (string key in keys) dump.Append(F((float)run.Value[key], "0.000")).Append(" ms  ").Append(key).Append('\n');
                        }
                    }
                    File.WriteAllText(Path.Combine(dir, "gpu-passes.txt"), dump.ToString(), new UTF8Encoding(false));
                }
                finally
                {
                    stack.Restore();
                    cameraData.renderPostProcessing = cameraPost;
                    lighting.SetWeather(0f, 0f);
                    lighting.RefreshWeather();
                }
                verdict = "PASS: " + string.Join(" | ", lines);
                Debug.Log(Tag + " " + verdict);
            }
            catch (Exception error)
            {
                verdict = "FAIL: " + error.Message + (lines.Count > 0 ? " | " + string.Join(" | ", lines) : string.Empty);
                Debug.LogError(Tag + " " + verdict + "\n" + error);
            }
            finally
            {
                // Ассет рендерера возвращается к тому, что лежит на диске.
                if (rendererData != null) SetData(rendererData, authoredData);
                ShaderUtil.allowAsyncCompilation = asyncShaders;
            }
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, "result.txt"), verdict, new UTF8Encoding(false));
            EditorApplication.isPlaying = false;
        }

        private static void SetData(UniversalRendererData rendererData, PostProcessData data)
        {
            if (rendererData.postProcessData == data) return;
            rendererData.postProcessData = data;
            rendererData.SetDirty();
        }

        private static PostStack WastelandStack(RoaWorldLighting lighting)
        {
            foreach (Volume volume in lighting.GetComponentsInChildren<Volume>(true))
            {
                if (volume == null || volume.name != "Wasteland Post Processing" || volume.profile == null) continue;
                var stack = new PostStack();
                if (volume.profile.TryGet(out stack.Color) && volume.profile.TryGet(out stack.Tonemap)
                    && volume.profile.TryGet(out stack.Vignette) && volume.profile.TryGet(out stack.Bloom))
                    return stack;
            }
            return null;
        }

        private static string Label(Vector2Int size)
        {
            return size.x >= 1000 ? "desktop" : "mobile";
        }

        /// <summary>Кадр игровой камеры; первый рендер прогревает варианты шейдеров и пересборку рендерера.</summary>
        private static Frame Shoot(Camera camera, Vector2Int size, string path)
        {
            Texture2D image = Capture(camera, size.x, size.y, 2);
            try
            {
                File.WriteAllBytes(path, image.EncodeToPNG());
                return new Frame { Pixels = image.GetPixels32(), Width = size.x, Height = size.y };
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(image);
            }
        }

        private static Texture2D Capture(Camera camera, int width, int height, int renders)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            RenderTexture previousTarget = camera.targetTexture;
            RenderTexture previousActive = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                for (int i = 0; i < renders; i++) camera.Render();
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

        /// <summary>
        /// GPU-время проходов рендера игровой камеры по профайлер-сэмплерам: 40 кадров по
        /// четыре рендера в RT, у каждого прохода — минимум среднего за кадр. Видеокарту
        /// делят с другими процессами (открытый редактор), минимум отсекает их всплески.
        /// </summary>
        private static async Task<Dictionary<string, double>> GpuPasses(Camera camera, Vector2Int size)
        {
            var result = new Dictionary<string, double>();
            if (!SystemInfo.supportsGpuRecorder) return result;
            var names = new List<string>();
            Sampler.GetNames(names);
            var recorders = new List<KeyValuePair<string, Recorder>>();
            foreach (string name in names)
            {
                if (name.StartsWith("Inl_", StringComparison.Ordinal)) continue;
                string lower = name.ToLowerInvariant();
                if (!(lower.Contains("blit") || lower.StartsWith("rg_", StringComparison.Ordinal) || lower.Contains("draw")
                      || lower.Contains("render") || lower.Contains("camera") || lower.Contains("shadow") || lower.Contains("lut")
                      || lower.Contains("bloom") || lower.Contains("uber") || lower.Contains("post") || lower.Contains("final")
                      || lower.Contains("copy") || lower.Contains("opaque") || lower.Contains("transparent"))) continue;
                Recorder recorder = Recorder.Get(name);
                if (recorder == null || !recorder.isValid) continue;
                recorder.enabled = true;
                recorders.Add(new KeyValuePair<string, Recorder>(name, recorder));
            }
            var target = new RenderTexture(size.x, size.y, 24, RenderTextureFormat.ARGB32);
            RenderTexture previousTarget = camera.targetTexture;
            try
            {
                camera.targetTexture = target;
                for (int frame = 0; frame < 40; frame++)
                {
                    for (int i = 0; i < 4; i++) camera.Render();
                    int now = Time.frameCount;
                    while (Time.frameCount == now) await Task.Yield();
                    if (frame < 4) continue;
                    foreach (KeyValuePair<string, Recorder> pair in recorders)
                    {
                        Recorder r = pair.Value;
                        if (r.gpuSampleBlockCount == 0) continue;
                        double ms = r.gpuElapsedNanoseconds / 1e6 / r.gpuSampleBlockCount;
                        double best;
                        if (!result.TryGetValue(pair.Key, out best) || ms < best) result[pair.Key] = ms;
                    }
                }
            }
            finally
            {
                camera.targetTexture = previousTarget;
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
                foreach (KeyValuePair<string, Recorder> pair in recorders) pair.Value.enabled = false;
            }
            return result;
        }

        /// <summary>Проходы постобработки и финального блита — то, что включение поста добавляет или заменяет.</summary>
        private static string PostPasses(Dictionary<string, double> passes)
        {
            var parts = new List<string>();
            double sum = 0;
            var keys = new List<string>(passes.Keys);
            keys.Sort(StringComparer.Ordinal);
            foreach (string key in keys)
            {
                string lower = key.ToLowerInvariant();
                if (!(lower.StartsWith("blit", StringComparison.Ordinal) || lower.Contains("final"))) continue;
                parts.Add(key + " " + F((float)passes[key], "0.000"));
                sum += passes[key];
            }
            return parts.Count == 0 ? "no gpu samples" : string.Join(", ", parts) + " = " + F((float)sum, "0.000") + " ms";
        }

        private struct Diff
        {
            public float MeanDelta;
            public int MaxDelta;
            public float ChangedShare;
        }

        private static Diff Compare(Frame a, Frame b)
        {
            long sum = 0;
            int max = 0, changed = 0;
            for (int i = 0; i < a.Pixels.Length; i++)
            {
                Color32 p = a.Pixels[i], q = b.Pixels[i];
                int dr = Math.Abs(p.r - q.r), dg = Math.Abs(p.g - q.g), db = Math.Abs(p.b - q.b);
                int d = Math.Max(dr, Math.Max(dg, db));
                sum += dr + dg + db;
                if (d > max) max = d;
                if (d > 2) changed++;
            }
            return new Diff
            {
                MeanDelta = sum / (3f * a.Pixels.Length),
                MaxDelta = max,
                ChangedShare = changed / (float)a.Pixels.Length
            };
        }

        /// <summary>
        /// Средний цвет, яркость (Rec.709 по sRGB-значениям 0..255, среднее и 5/50/95-й
        /// перцентили), линейная яркость в ступенях относительно эталона, насыщенность
        /// (HSV S), доля выбитых (≥250) и провалившихся (≤5) пикселей, разница с эталоном.
        /// </summary>
        private static string Describe(Frame frame, Frame reference)
        {
            var histogram = new int[256];
            double r = 0, g = 0, b = 0, linear = 0, saturation = 0;
            int clipped = 0, crushed = 0;
            foreach (Color32 c in frame.Pixels)
            {
                r += c.r; g += c.g; b += c.b;
                int luma = Mathf.Clamp(Mathf.RoundToInt(0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b), 0, 255);
                histogram[luma]++;
                if (luma >= 250) clipped++;
                if (luma <= 5) crushed++;
                linear += 0.2126 * Linear(c.r) + 0.7152 * Linear(c.g) + 0.0722 * Linear(c.b);
                int hi = Math.Max(c.r, Math.Max(c.g, c.b)), lo = Math.Min(c.r, Math.Min(c.g, c.b));
                saturation += hi == 0 ? 0 : (hi - lo) / (double)hi;
            }
            int n = frame.Pixels.Length;
            var text = new StringBuilder();
            text.Append("rgb (").Append(Mathf.RoundToInt((float)(r / n))).Append(',').Append(Mathf.RoundToInt((float)(g / n)))
                .Append(',').Append(Mathf.RoundToInt((float)(b / n))).Append(')');
            text.Append(" luma ").Append(F((float)((0.2126 * r + 0.7152 * g + 0.0722 * b) / n), "0.0"));
            text.Append(" p5/50/95 ").Append(Percentile(histogram, n, 0.05f)).Append('/').Append(Percentile(histogram, n, 0.5f))
                .Append('/').Append(Percentile(histogram, n, 0.95f));
            text.Append(" sat ").Append(F((float)(saturation / n), "0.000"));
            text.Append(" clip ").Append(F(clipped * 100f / n, "0.0")).Append("% crush ").Append(F(crushed * 100f / n, "0.0")).Append('%');
            if (reference != null)
            {
                double refLinear = 0;
                foreach (Color32 c in reference.Pixels)
                    refLinear += 0.2126 * Linear(c.r) + 0.7152 * Linear(c.g) + 0.0722 * Linear(c.b);
                Diff diff = Compare(frame, reference);
                text.Append(" dEV ").Append(F((float)Math.Log(linear / Math.Max(1e-6, refLinear), 2), "+0.00;-0.00"));
                text.Append(" diff mean ").Append(F(diff.MeanDelta, "0.0")).Append(" max ").Append(diff.MaxDelta)
                    .Append(" changed ").Append(F(diff.ChangedShare * 100f, "0.0")).Append('%');
            }
            return text.ToString();
        }

        private static double Linear(byte value)
        {
            double c = value / 255.0;
            return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        }

        private static int Percentile(int[] histogram, int total, float share)
        {
            int limit = Mathf.CeilToInt(total * share), seen = 0;
            for (int i = 0; i < histogram.Length; i++)
            {
                seen += histogram[i];
                if (seen >= limit) return i;
            }
            return 255;
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
