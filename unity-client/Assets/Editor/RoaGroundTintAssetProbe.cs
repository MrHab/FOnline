#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Kromka;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Play Mode proof that the day/night ground tint never reaches a ground material.
    /// Every Kromka_Local_*.mat sits on a live renderer (personalBase's own ground, a cube
    /// for each other region), runs through a day/night cycle, and Play Mode is stopped at
    /// night. At every hour and after Play Mode each material's serialized state (what the
    /// editor would write on its next save) must equal the one taken before the run, and
    /// its .mat bytes must not change; the probe itself never saves assets. The same run
    /// renders the tint through the property block and through the old material write into
    /// a linear half-float target and requires the same image.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaGroundTintAssetProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить, что день и ночь не пишут в материалы земли";
        private const string Key = "Roa.GroundTintAssetProbe";
        private const string Tag = "[ОТТЕНОК ЗЕМЛИ] ";
        private const string MaterialFolder = "Assets/Art/Kromka/Materials";
        private const string StartLocation = "personalBase";
        private const int CaptureLayer = 30;
        private const int CaptureSize = 32;
        private const float StopHour = 23.5f;
        private const double PlayTimeoutSeconds = 180d;
        private static readonly float[] CaptureHours = { 12f, 18.5f, 0f };
        private static readonly float[] CycleHours =
            { 6f, 9f, 12f, RoaWorldLighting.WebFixedWorldHour, 18f, 21f, 0f, 3f, StopHour };
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int ColorId = Shader.PropertyToID("_Color");

        // Ground keys of the four location kinds, passed in the location's visual profile so
        // the expected tint does not depend on RoaWorldLighting's built-in profile table.
        private static readonly Profile[] Profiles =
        {
            new Profile("settlement", true, "#b29370", 0.10f, "#8e735a"),
            new Profile("resource", true, "#927b68", 0.22f, "#78695a"),
            new Profile("lair", false, "#738087", 0.36f, "#626d72"),
            new Profile("wasteland", true, "#0033ff", 0.65f, "#b79a70")
        };

        // Held from the baseline to the check after Play Mode, so both look at the same
        // objects: leaving Play Mode unloads unused assets, and a reload re-runs URP's
        // ValidateMaterial, which copies _BaseColor into _Color.
        private static readonly List<Material> Held = new List<Material>();
        private static readonly Regex SavedColor = new Regex(
            @"^\s*- _Color: \{r: ([^,]+), g: ([^,]+), b: ([^,]+), a: ([^}]+)\}", RegexOptions.Multiline);
        private static bool _auditRunning;
        private static double _deadline;

        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath,
            "../Library/GroundTintAssetProbe/result.txt"));

        static RoaGroundTintAssetProbe()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            EditorApplication.update += Watchdog;
        }

        [MenuItem(MenuPath)]
        public static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Сначала выйдите из Play Mode.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Сначала сохраните открытые сцены.");
            string startScene = KromkaLocationSceneCatalog.ScenePath(StartLocation);
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(startScene) == null)
                throw new InvalidOperationException("Нет сцены " + startScene);

            var baseline = new JArray();
            var synced = new List<string>();
            Held.Clear();
            foreach (string path in GroundMaterialPaths())
            {
                Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
                Held.Add(material);
                Color? saved = FileColor(path);
                if (saved.HasValue && material.HasProperty(ColorId) && material.GetColor(ColorId) != saved.Value)
                    synced.Add(Path.GetFileNameWithoutExtension(path));
                baseline.Add(new JObject
                {
                    ["path"] = path,
                    ["sha"] = FileHash(path),
                    ["state"] = EditorJsonUtility.ToJson(material),
                    ["base"] = ColorText(material, BaseColorId),
                    ["color"] = ColorText(material, ColorId)
                });
            }
            if (baseline.Count == 0)
                throw new InvalidOperationException("В " + MaterialFolder + " нет Kromka_Local_*.mat");

            Directory.CreateDirectory(Path.GetDirectoryName(Output));
            File.WriteAllText(Output, "RUNNING");
            SessionState.SetString(Key + ".baseline", baseline.ToString());
            SessionState.SetString(Key + ".synced", string.Join(", ", synced));
            SessionState.SetString(Key + ".play", string.Empty);
            SessionState.SetString(Key + ".scene", AssetDatabase.GetAssetPath(EditorSceneManager.playModeStartScene));
            SessionState.SetBool(Key, true);
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(startScene);
            EditorApplication.isPlaying = true;
        }

        /// <summary>Batch entry, run WITHOUT -quit: the editor exits with 0 on PASS and 1 otherwise.</summary>
        public static void RunBatch()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("В редакторе используйте пункт меню.");
            SessionState.SetBool(Key + ".batch", true);
            Run();
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (!SessionState.GetBool(Key, false)) return;
            if (state == PlayModeStateChange.EnteredPlayMode)
            {
                _auditRunning = true;
                _deadline = EditorApplication.timeSinceStartup + PlayTimeoutSeconds;
                if (Held.Count == 0) // the domain was reloaded on the way in
                    foreach (JToken row in JArray.Parse(SessionState.GetString(Key + ".baseline", "[]")))
                        Held.Add(AssetDatabase.LoadAssetAtPath<Material>(row["path"].ToString()));
                try
                {
                    // The capture lighting doubles as the coroutine host.
                    var capture = new GameObject("GroundTintCaptureLighting").AddComponent<RoaWorldLighting>();
                    capture.StartCoroutine(Audit(capture));
                }
                catch (Exception error)
                {
                    StopPlay(new List<string> { "запуск: " + error.Message }, null);
                }
                return;
            }
            if (state != PlayModeStateChange.EnteredEditMode) return;

            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(
                SessionState.GetString(Key + ".scene", string.Empty));
            SessionState.SetBool(Key, false);
            _auditRunning = false;
            string report = Verify();
            Held.Clear();
            File.WriteAllText(Output, report);
            bool pass = report.StartsWith("PASS", StringComparison.Ordinal);
            if (pass) Debug.Log(Tag + report);
            else Debug.LogError(Tag + report);
            if (Application.isBatchMode && SessionState.GetBool(Key + ".batch", false))
            {
                SessionState.SetBool(Key + ".batch", false);
                EditorApplication.Exit(pass ? 0 : 1);
            }
        }

        private static void Watchdog()
        {
            if (!_auditRunning || !EditorApplication.isPlaying || EditorApplication.timeSinceStartup < _deadline) return;
            StopPlay(new List<string> { "проверка в Play Mode не закончилась за " + PlayTimeoutSeconds + " с" }, null);
        }

        private static void StopPlay(List<string> failures, string summary)
        {
            _auditRunning = false;
            SessionState.SetString(Key + ".play", failures.Count == 0
                ? "PASS: " + summary
                : "FAIL: " + string.Join("; ", failures.Take(12)));
            EditorApplication.isPlaying = false;
        }

        private static IEnumerator Audit(RoaWorldLighting capture)
        {
            var failures = new List<string>();
            var targets = new List<Target>();
            var frames = new List<string>();
            yield return null;
            if (!Step(failures, () => Setup(targets)))
            {
                StopPlay(failures, null);
                yield break;
            }
            if (!Step(failures, () => CheckCaptures(capture, targets[0], failures, frames)))
            {
                StopPlay(failures, null);
                yield break;
            }

            if (!Step(failures, () =>
                {
                    foreach (Target target in targets)
                    {
                        target.Lighting = new GameObject("GroundTintCycleLighting").AddComponent<RoaWorldLighting>();
                        target.Lighting.SetLocation(target.Location, target.Renderer);
                    }
                }))
            {
                StopPlay(failures, null);
                yield break;
            }
            foreach (float hour in CycleHours)
            {
                if (!Step(failures, () =>
                    {
                        foreach (Target target in targets)
                        {
                            target.Lighting.FixedWorldHour = hour;
                            target.Lighting.SetLocalWorldActive(true);
                        }
                    }))
                {
                    StopPlay(failures, null);
                    yield break;
                }
                // Two real frames draw the tinted ground before the next check.
                yield return null;
                yield return null;
                if (!Step(failures, () =>
                    {
                        foreach (Target target in targets)
                            RequireTint(target.Renderer, Expected(target, hour),
                                Name(target) + " в " + HourText(hour), failures);
                        CheckMaterials(targets, HourText(hour), failures);
                    }))
                {
                    StopPlay(failures, null);
                    yield break;
                }
            }

            // Play Mode stops here with the night tint still on the ground, the way a
            // developer stops it mid-cycle.
            StopPlay(failures, targets.Count + " материалов Kromka_Local_* прошли часы "
                + string.Join(", ", CycleHours.Select(HourText)) + " (земля " + StartLocation
                + " — своя, остальные — на кубах), оттенок в блоке свойств совпал с формулой, "
                + "кадр с блоком = кадру старой записи в материал (" + string.Join(", ", frames)
                + "), Play Mode остановлен ночью");
        }

        private static void Setup(List<Target> targets)
        {
            RoaUnityLocationScene scene = Object.FindAnyObjectByType<RoaUnityLocationScene>();
            Renderer sceneGround = scene != null ? scene.GroundRenderer : null;
            JArray baseline = JArray.Parse(SessionState.GetString(Key + ".baseline", "[]"));
            for (int i = 0; i < baseline.Count; i++)
            {
                string path = baseline[i]["path"].ToString();
                Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
                Require(material != null, "не загрузился " + path);
                Profile profile = Profiles[i % Profiles.Length];
                var target = new Target
                {
                    AssetPath = path,
                    Material = material,
                    State = baseline[i]["state"].ToString(),
                    BaseBaseline = baseline[i]["base"].ToString(),
                    ColorBaseline = baseline[i]["color"].ToString(),
                    Profile = profile,
                    Base = ReadColor(material),
                    Location = new LocationDefinition
                    {
                        Id = "ground_tint_probe_" + i,
                        Kind = profile.Kind,
                        Safe = profile.Safe,
                        VisualProfile = new JObject
                        {
                            ["groundDay"] = profile.Day,
                            ["groundDayMix"] = profile.DayMix,
                            ["groundNight"] = profile.Night
                        }
                    },
                    Renderer = sceneGround != null && sceneGround.sharedMaterial == material
                        ? sceneGround
                        : GroundCube("GroundTintCycle:" + Path.GetFileNameWithoutExtension(path), material,
                            new Vector3(i * 8f, -300f, 0f), 0)
                };
                targets.Add(target);
            }
            Require(targets.Count > 0, "нет материалов для проверки");
            Require(sceneGround != null && targets.Any(target => target.Renderer == sceneGround),
                "земля сцены " + StartLocation + " не держит свой Kromka_Local_*.mat");
            foreach (Target target in targets)
                Require(!target.Renderer.HasPropertyBlock(), Name(target) + ": блок свойств есть ещё до проверки");
        }

        /// <summary>
        /// Renders the same ground three ways at several hours: tinted by RoaWorldLighting
        /// (property block), with the old material write of the expected colour, and plain.
        /// The first two must match; the tint must be visible against the plain one.
        /// </summary>
        private static void CheckCaptures(RoaWorldLighting capture, Target target, List<string> failures,
                                          List<string> frames)
        {
            Renderer cube = GroundCube("GroundTintCapture", target.Material, new Vector3(0f, -400f, 0f), CaptureLayer);
            var cameraObject = new GameObject("GroundTintCaptureCamera");
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.enabled = false;
            camera.orthographic = true;
            camera.orthographicSize = 1f;
            camera.cullingMask = 1 << CaptureLayer;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Color.black;
            // Linear half-float target: an 8-bit one clips the lit ground to white at noon.
            camera.allowHDR = true;
            camera.allowMSAA = false;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 50f;
            camera.transform.SetPositionAndRotation(new Vector3(0f, -390f, 0f), Quaternion.Euler(90f, 0f, 0f));
            var renderTarget = new RenderTexture(CaptureSize, CaptureSize, 24, RenderTextureFormat.ARGBHalf,
                RenderTextureReadWrite.Linear);
            renderTarget.Create();
            bool asyncCompilation = ShaderUtil.allowAsyncCompilation;
            ShaderUtil.allowAsyncCompilation = false;
            try
            {
                float strongest = 0f;
                float brightest = 0f;
                foreach (float hour in CaptureHours)
                {
                    capture.FixedWorldHour = hour;
                    capture.SetLocation(target.Location, cube);
                    capture.SetLocalWorldActive(true);
                    Color expected = Expected(target, hour);
                    string where = "кадр в " + HourText(hour);
                    RequireTint(cube, expected, where, failures);
                    Color[] tinted = Capture(camera, renderTarget);

                    cube.SetPropertyBlock(null, 0);
                    Color[] plain = Capture(camera, renderTarget);

                    // Exactly what the old WriteMaterialColor did, on a throwaway copy.
                    var legacy = new Material(target.Material) { name = "GroundTintLegacyWrite" };
                    legacy.color = expected;
                    if (legacy.HasProperty(BaseColorId)) legacy.SetColor(BaseColorId, expected);
                    cube.sharedMaterial = legacy;
                    Color[] written = Capture(camera, renderTarget);
                    cube.sharedMaterial = target.Material;
                    Object.Destroy(legacy);

                    float difference = MaxRelativeDifference(tinted, written);
                    string percent = (difference * 100f).ToString("0.###", CultureInfo.InvariantCulture) + "%";
                    if (difference > 0.005f)
                        failures.Add(where + ": кадр с блоком свойств расходится со старой записью в материал на "
                            + percent + " (блок " + Mean(tinted) + ", материал " + Mean(written) + ")");
                    frames.Add(HourText(hour) + ": блок " + Mean(tinted) + ", материал " + Mean(written)
                        + ", без оттенка " + Mean(plain) + ", расхождение " + percent);
                    strongest = Mathf.Max(strongest, MeanRelativeDifference(tinted, plain));
                    brightest = Mathf.Max(brightest, Brightness(plain));
                }
                if (brightest < 0.01f) failures.Add("камера пробы не видит землю: все кадры чёрные");
                if (strongest < 0.02f)
                    failures.Add("оттенок не виден на кадре: сильнейшее отличие от земли без оттенка "
                        + (strongest * 100f).ToString("0.0", CultureInfo.InvariantCulture) + "%");

                capture.SetLocation(target.Location, cube);
                capture.SetLocalWorldActive(true);
                if (!cube.HasPropertyBlock()) failures.Add("после SetLocation на земле нет блока свойств");
                capture.SetLocation(null, null);
                if (cube.HasPropertyBlock()) failures.Add("смена локации не сняла оттенок с прежней земли");
                capture.SetLocation(target.Location, cube);
                capture.SetLocalWorldActive(true);
                capture.SetLocalWorldActive(false);
                if (cube.HasPropertyBlock()) failures.Add("выход из мира (SetLocalWorldActive(false)) не снял оттенок с земли");
                capture.SetLocation(null, null);
                CheckMaterials(new List<Target> { target }, "кадры", failures);
            }
            finally
            {
                ShaderUtil.allowAsyncCompilation = asyncCompilation;
                RenderTexture.active = null;
                renderTarget.Release();
                Object.Destroy(renderTarget);
                Object.Destroy(cameraObject);
                Object.Destroy(cube.gameObject);
            }
        }

        private static string Verify()
        {
            var failures = new List<string>();
            string play = SessionState.GetString(Key + ".play", string.Empty);
            if (string.IsNullOrEmpty(play)) failures.Add("Play Mode закончился раньше, чем проверка в нём");
            else if (!play.StartsWith("PASS", StringComparison.Ordinal)) failures.Add("Play Mode: " + play);

            JArray baseline = JArray.Parse(SessionState.GetString(Key + ".baseline", "[]"));
            foreach (JToken row in baseline)
            {
                string path = row["path"].ToString();
                Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (material == null)
                {
                    failures.Add(path + " пропал");
                    continue;
                }
                // The serialized state is exactly what the next asset save writes into the .mat.
                if (EditorJsonUtility.ToJson(material) != row["state"].ToString())
                    failures.Add(path + " изменён в памяти и уйдёт в .mat при сохранении: _BaseColor "
                        + ColorText(material, BaseColorId) + " вместо " + row["base"] + ", _Color "
                        + ColorText(material, ColorId) + " вместо " + row["color"]);
                if (FileHash(path) != row["sha"].ToString())
                    failures.Add(path + " изменился на диске (вернуть: git checkout -- unity-client/" + path + ")");
            }
            string synced = SessionState.GetString(Key + ".synced", string.Empty);
            string note = synced.Length == 0 ? string.Empty
                : "; справка: у " + synced + " _Color в памяти уже до запуска равен _BaseColor — это URP "
                  + "ValidateMaterial при загрузке, при следующем сохранении ассетов попадёт в .mat, к оттенку не относится";
            if (failures.Count > 0) return "FAIL: " + string.Join("; ", failures.Take(40)) + note;
            return play + "; после выхода из Play Mode все " + baseline.Count
                + " материалов в памяти те же, что до запуска, .mat байт-в-байт прежние" + note;
        }

        private static void CheckMaterials(List<Target> targets, string where, List<string> failures)
        {
            foreach (Target target in targets)
                if (EditorJsonUtility.ToJson(target.Material) != target.State)
                    failures.Add(where + ": " + Name(target) + " изменён в памяти: _BaseColor "
                        + ColorText(target.Material, BaseColorId) + " вместо " + target.BaseBaseline + ", _Color "
                        + ColorText(target.Material, ColorId) + " вместо " + target.ColorBaseline);
        }

        private static void RequireTint(Renderer renderer, Color expected, string where, List<string> failures)
        {
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block, 0);
            if (!block.HasColor(BaseColorId))
            {
                failures.Add(where + ": на земле нет оттенка в блоке свойств");
                return;
            }
            Color actual = block.GetColor(BaseColorId);
            if (Mathf.Abs(actual.r - expected.r) > 2e-4f || Mathf.Abs(actual.g - expected.g) > 2e-4f
                || Mathf.Abs(actual.b - expected.b) > 2e-4f || Mathf.Abs(actual.a - expected.a) > 2e-4f)
                failures.Add(where + ": оттенок " + actual + " вместо " + expected);
        }

        /// <summary>The colour RoaWorldLighting.ApplyGroundTint gives this ground at this hour.</summary>
        private static Color Expected(Target target, float hour)
        {
            Color day = Color.Lerp(target.Base, Html(target.Profile.Day), target.Profile.DayMix);
            return Color.Lerp(day, Html(target.Profile.Night), RoaWorldLighting.Evaluate(hour).GroundTintMix);
        }

        private static Color[] Capture(Camera camera, RenderTexture target)
        {
            // Twice: the first frame of a fresh shader variant can come out wrong.
            for (int pass = 0; pass < 2; pass++)
            {
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
                else
                {
                    camera.targetTexture = target;
                    camera.Render();
                    camera.targetTexture = null;
                }
            }
            RenderTexture previous = RenderTexture.active;
            var pixels = new Texture2D(CaptureSize, CaptureSize, TextureFormat.RGBAHalf, false, true);
            try
            {
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, CaptureSize, CaptureSize), 0, 0);
                pixels.Apply(false, false);
                return pixels.GetPixels();
            }
            finally
            {
                RenderTexture.active = previous;
                Object.Destroy(pixels);
            }
        }

        private static Renderer GroundCube(string name, Material material, Vector3 position, int layer)
        {
            GameObject cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name;
            cube.layer = layer;
            cube.transform.position = position;
            cube.transform.localScale = new Vector3(6f, 0.2f, 6f);
            Renderer renderer = cube.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            return renderer;
        }

        private static IEnumerable<string> GroundMaterialPaths()
        {
            return AssetDatabase.FindAssets("t:Material", new[] { MaterialFolder })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => Path.GetFileName(path).StartsWith("Kromka_Local_", StringComparison.Ordinal)
                    && path.EndsWith(".mat", StringComparison.OrdinalIgnoreCase))
                .OrderBy(path => path, StringComparer.Ordinal);
        }

        private static bool Step(List<string> failures, Action action)
        {
            try
            {
                action();
                return true;
            }
            catch (Exception error)
            {
                failures.Add(error.Message);
                return false;
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static Color ReadColor(Material material)
        {
            return material.HasProperty(BaseColorId) ? material.GetColor(BaseColorId) : material.color;
        }

        private static string ColorText(Material material, int id)
        {
            if (!material.HasProperty(id)) return string.Empty;
            Color color = material.GetColor(id);
            return string.Join(",", new[] { color.r, color.g, color.b, color.a }
                .Select(value => value.ToString("R", CultureInfo.InvariantCulture)));
        }

        /// <summary>_Color as written in the .mat file, or null when the file has none.</summary>
        private static Color? FileColor(string assetPath)
        {
            string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetPath));
            Match match = SavedColor.Match(File.ReadAllText(fullPath));
            if (!match.Success) return null;
            float Channel(int group) => float.Parse(match.Groups[group].Value.Trim(), CultureInfo.InvariantCulture);
            return new Color(Channel(1), Channel(2), Channel(3), Channel(4));
        }

        private static string FileHash(string assetPath)
        {
            string fullPath = Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetPath));
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(fullPath))).Replace("-", string.Empty);
        }

        private static Color Html(string value)
        {
            if (!ColorUtility.TryParseHtmlString(value, out Color color))
                throw new InvalidOperationException("Некорректный цвет пробы: " + value);
            return color;
        }

        /// <summary>Largest per-channel difference, relative to the brighter value (floor 0.05).</summary>
        private static float MaxRelativeDifference(Color[] a, Color[] b)
        {
            float max = 0f;
            for (int i = 0; i < a.Length; i++)
            {
                max = Mathf.Max(max, Relative(a[i].r, b[i].r));
                max = Mathf.Max(max, Relative(a[i].g, b[i].g));
                max = Mathf.Max(max, Relative(a[i].b, b[i].b));
            }
            return max;
        }

        private static float MeanRelativeDifference(Color[] a, Color[] b)
        {
            float sum = 0f;
            for (int i = 0; i < a.Length; i++)
                sum += Relative(a[i].r, b[i].r) + Relative(a[i].g, b[i].g) + Relative(a[i].b, b[i].b);
            return sum / (a.Length * 3f);
        }

        private static float Relative(float a, float b)
        {
            return Mathf.Abs(a - b) / Mathf.Max(0.05f, Mathf.Max(Mathf.Abs(a), Mathf.Abs(b)));
        }

        private static float Brightness(Color[] pixels)
        {
            float sum = 0f;
            foreach (Color pixel in pixels) sum += pixel.r + pixel.g + pixel.b;
            return sum / (pixels.Length * 3f);
        }

        private static string Mean(Color[] pixels)
        {
            float r = 0f, g = 0f, b = 0f;
            foreach (Color pixel in pixels)
            {
                r += pixel.r;
                g += pixel.g;
                b += pixel.b;
            }
            return string.Format(CultureInfo.InvariantCulture, "{0:0.000}/{1:0.000}/{2:0.000}",
                r / pixels.Length, g / pixels.Length, b / pixels.Length);
        }

        private static string Name(Target target)
        {
            return Path.GetFileNameWithoutExtension(target.AssetPath);
        }

        private static string HourText(float hour)
        {
            return hour.ToString("0.#", CultureInfo.InvariantCulture) + " ч";
        }

        private sealed class Target
        {
            public string AssetPath;
            public Material Material;
            public string State;
            public string BaseBaseline;
            public string ColorBaseline;
            public Color Base;
            public Profile Profile;
            public LocationDefinition Location;
            public Renderer Renderer;
            public RoaWorldLighting Lighting;
        }

        private readonly struct Profile
        {
            public readonly string Kind;
            public readonly bool Safe;
            public readonly string Day;
            public readonly float DayMix;
            public readonly string Night;

            public Profile(string kind, bool safe, string day, float dayMix, string night)
            {
                Kind = kind;
                Safe = safe;
                Day = day;
                DayMix = dayMix;
                Night = night;
            }
        }
    }
}
#endif
