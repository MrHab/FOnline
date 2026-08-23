using System;
using System.Threading.Tasks;
using GLTFast;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using Stopwatch = System.Diagnostics.Stopwatch;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Loads and renders the real creator GLB into the same off-screen target the
    /// player sees. This verifies the network asset, appearance variants, isolated
    /// layer, camera/lights and non-empty pixels rather than only the UI contract.
    /// </summary>
    public static class RoaCharacterPreviewProbe
    {
        private const string BaseUrl = "http://127.0.0.1:3000";

        [MenuItem("Realm of Ashes/Проверить предпросмотр создания персонажа")]
        public static async void Run()
        {
            try { await RunAsync(); }
            catch (Exception error) { Debug.LogError("[ПРЕДПРОСМОТР ПЕРСОНАЖА] " + error); }
        }

        public static async Task RunAsync()
        {
            GameObject host = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            var deferAgent = new UninterruptedDeferAgent();
            try
            {
                // glTFast's normal runtime default owns a DontDestroyOnLoad
                // MonoBehaviour. Edit-mode probes use the package's dedicated
                // uninterrupted agent instead.
                GltfImport.SetDefaultDeferAgent(deferAgent);
                host = new GameObject("RoaCharacterPreviewProbe");
                RoaCharacterPreview preview = host.AddComponent<RoaCharacterPreview>();
                var appearance = new CharacterAppearance
                {
                    Sex = "male",
                    BodyType = "medium",
                    FaceId = "male_04",
                    HairId = "short_crop",
                    HairColorId = "hair_08"
                };

                preview.Show(BaseUrl, appearance, 320, 360);
                Check(preview.Texture != null, "render texture не создана");
                Check(preview.Texture.width == 320 && preview.Texture.height == 360,
                    "неверный размер render texture");
                Check(preview.RequestedModelKey == "male_medium", "неверно выбран body GLB");

                await WaitUntilReady(preview, 30000);

                RoaCharacterView loaded = host.GetComponentInChildren<RoaCharacterView>(true);
                Check(loaded != null && loaded.Ready, "RoaCharacterView не готов");
                Check(loaded.BodyKey == "male_medium", "загружено не то тело");
                Check(loaded.AnyHairVisible, "выбранная причёска не видна");
                CheckHairTint(loaded, "#5B2922");

                foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                {
                    if (node == host.transform) continue;
                    Check(node.gameObject.layer == RoaCharacterPreview.PreviewLayer,
                        "объект предпросмотра вышел из изолированного слоя: " + node.name);
                }
                Camera camera = host.GetComponentInChildren<Camera>(true);
                Check(camera != null && camera.cullingMask == (1 << RoaCharacterPreview.PreviewLayer),
                    "камера видит игровой мир");
                Light[] lights = host.GetComponentsInChildren<Light>(true);
                Check(lights.Length == 3, "ожидалось три студийных источника света");
                foreach (Light light in lights)
                    Check(light.cullingMask == (1 << RoaCharacterPreview.PreviewLayer),
                        "свет предпросмотра затрагивает игровой мир");

                // A same-body edit must reuse the already loaded model and update
                // visible variants immediately instead of issuing another request.
                appearance.FaceId = "male_02";
                appearance.HairId = "shaved";
                appearance.HairColorId = "hair_07";
                preview.Show(BaseUrl, appearance, 320, 360);
                Check(host.GetComponentInChildren<RoaCharacterView>(true) == loaded,
                    "смена лица пересоздала body GLB");
                Check(!loaded.AnyHairVisible, "вариант shaved не скрыл волосы");

                appearance.HairId = "short_crop";
                preview.Show(BaseUrl, appearance, 320, 360);
                Check(loaded.AnyHairVisible, "возврат причёски не показал волосы");

                // Animation components do not advance automatically in edit mode.
                // Sample the same idle state that is already playing in a player,
                // so the captured framing represents the actual creator screen.
                Animation animation = loaded.GetComponentInChildren<Animation>(true);
                Check(animation != null && animation["idle"] != null, "idle-клип недоступен");
                AnimationState idle = animation["idle"];
                idle.enabled = true;
                idle.weight = 1f;
                idle.time = Mathf.Min(0.35f, idle.length * 0.35f);
                animation.Sample();

                Check(preview.RenderNow(), "камера не выполнила off-screen render");
                RenderTexture.active = preview.Texture;
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, preview.Texture.width, preview.Texture.height), 0, 0);
                readback.Apply(false, false);

                Color32[] pixels = readback.GetPixels32();
                int nonBackground = 0;
                foreach (Color32 pixel in pixels)
                {
                    int brightest = Math.Max(pixel.r, Math.Max(pixel.g, pixel.b));
                    if (brightest >= 24) nonBackground++;
                }
                Check(nonBackground >= pixels.Length / 200,
                    "render texture пуста: отличимых пикселей=" + nonBackground);

                string capturePath = Environment.GetEnvironmentVariable("ROA_UNITY_AUDIT_CAPTURE");
                if (!string.IsNullOrWhiteSpace(capturePath))
                {
                    System.IO.File.WriteAllBytes(capturePath, readback.EncodeToPNG());
                    Debug.Log("[ПРЕДПРОСМОТР ПЕРСОНАЖА] кадр: " + capturePath);
                }

                Debug.Log("[ПРЕДПРОСМОТР ПЕРСОНАЖА] готово: GLB=male_medium, 320×360, "
                    + "варианты=лицо/волосы/цвет, слой=31, свет=3, пикселей=" + nonBackground);
            }
            finally
            {
                GltfImport.UnsetDefaultDeferAgent(deferAgent);
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static async Task WaitUntilReady(RoaCharacterPreview preview, int timeoutMs)
        {
            var timer = Stopwatch.StartNew();
            while (!preview.IsReady && timer.ElapsedMilliseconds < timeoutMs)
            {
                if (preview.StatusText.StartsWith("Не удалось", StringComparison.Ordinal)) break;
                await Task.Delay(50);
            }
            Check(preview.IsReady,
                "GLB не готов за " + timeoutMs + " мс; статус: " + preview.StatusText);
        }

        private static void CheckHairTint(RoaCharacterView view, string html)
        {
            Check(ColorUtility.TryParseHtmlString(html, out Color expected), "не разобран эталонный цвет волос");
            if (QualitySettings.activeColorSpace == ColorSpace.Linear) expected = expected.linear;
            bool found = false;
            foreach (Transform node in view.GetComponentsInChildren<Transform>(true))
            {
                if (!node.name.StartsWith("hair_", StringComparison.Ordinal)) continue;
                foreach (Renderer renderer in node.GetComponentsInChildren<Renderer>(true))
                foreach (Material material in renderer.sharedMaterials)
                {
                    if (material == null) continue;
                    string property = material.HasProperty("baseColorFactor") ? "baseColorFactor"
                        : material.HasProperty("_BaseColor") ? "_BaseColor"
                        : material.HasProperty("_Color") ? "_Color" : string.Empty;
                    if (string.IsNullOrEmpty(property)) continue;
                    Color actual = material.GetColor(property);
                    if (Mathf.Abs(actual.r - expected.r) < 0.015f
                        && Mathf.Abs(actual.g - expected.g) < 0.015f
                        && Mathf.Abs(actual.b - expected.b) < 0.015f) found = true;
                }
            }
            Check(found, "hair_08 не записан в реальное color-свойство материала");
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
