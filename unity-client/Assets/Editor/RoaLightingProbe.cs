#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Checks the day/night formula without changing the running scene.</summary>
    public static class RoaLightingProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить день и ночь";

        [MenuItem(MenuPath)]
        public static void Run()
        {
            try
            {
                RoaWorldLighting.LightingSample noon = RoaWorldLighting.Evaluate(12f);
                RoaWorldLighting.LightingSample midnight = RoaWorldLighting.Evaluate(0f);
                RoaWorldLighting.LightingSample dawn = RoaWorldLighting.Evaluate(6f);
                RoaWorldLighting.LightingSample fixedWeb = RoaWorldLighting.Evaluate(RoaWorldLighting.WebFixedWorldHour);
                RoaWorldLighting.LightingSample mobileWeb = RoaWorldLighting.Evaluate(
                    RoaWorldLighting.WebFixedWorldHour, null, true);

                var oldKlim = new JObject
                {
                    ["id"] = "old-klim-caravan-yard-v1",
                    ["skyDay"] = "#596473",
                    ["fogDay"] = "#4f5964",
                    ["hemiSkyDay"] = "#d8d2c6",
                    ["hemiGroundDay"] = "#526171",
                    ["fillDay"] = "#c7d1dc",
                    ["sunDay"] = "#ffd39a",
                    ["rimDay"] = "#9fb4ca",
                    ["fogDensityDay"] = 0.0019f,
                    ["exposureDay"] = 1.08f,
                    ["hemiIntensityScale"] = 0.9f,
                    ["fillIntensityScale"] = 0.75f,
                    ["sunIntensityScale"] = 1.06f,
                    ["rimIntensityScale"] = 0.86f
                };
                RoaWorldLighting.LightingSample authoredNoon = RoaWorldLighting.Evaluate(12f, oldKlim);

                Require(noon.Daylight > 0.99f, "полдень не стал дневным");
                Require(noon.SunIntensity > 1.03f && noon.SunIntensity < 1.07f && noon.MoonIntensity < 0.01f,
                        "полуденные солнце/луна имеют неверную яркость");
                Require(noon.SunShadows, "полуденные тени выключены");

                Require(midnight.Daylight < 0.01f, "полночь не стала ночной");
                Require(midnight.SunIntensity < 0.01f && midnight.MoonIntensity > 0.36f,
                        "ночные солнце/луна имеют неверную яркость");
                Require(!midnight.SunShadows, "ночью остались солнечные тени");
                Require(midnight.GroundTintMix > 0.55f, "ночной оттенок земли не включился");

                Require(dawn.Twilight > 0.99f, "рассвет не вошёл в сумеречную фазу");
                Require(fixedWeb.SunIntensity > fixedWeb.MoonIntensity && fixedWeb.SunShadows,
                        "фиксированное время web-клиента не даёт дневной свет");
                Require(fixedWeb.Exposure < 1.08f && fixedWeb.FogDensity < 0.0024f
                        && mobileWeb.Exposure < 1.10f,
                        "дневной профиль снова выбивает землю в пересвет");
                Require(ApproximatelyColor(authoredNoon.SkyColor, Html("#596473")),
                        "авторский цвет неба Старого Клима потерян");
                Require(Mathf.Abs(authoredNoon.SunIntensity - 1.05f * 1.06f) < 0.001f,
                        "авторский множитель солнца Старого Клима потерян");
                Require(Mathf.Abs(authoredNoon.FogDensity - 0.0019f) < 0.00001f,
                        "авторская плотность тумана Старого Клима потеряна");

                CaptureProfilesIfRequested();

                Debug.Log("[ДЕНЬ/НОЧЬ] готово: полдень sun=" + noon.SunIntensity.ToString("0.00")
                    + ", полночь moon=" + midnight.MoonIntensity.ToString("0.00")
                    + ", рассвет twilight=" + dawn.Twilight.ToString("0.00")
                    + ", web " + fixedWeb.Hour.ToString("0.0") + "h daylight=" + fixedWeb.Daylight.ToString("0.00"));
            }
            catch (Exception error)
            {
                Debug.LogError("[ДЕНЬ/НОЧЬ] ошибка: " + error.Message);
            }
        }

        private struct CameraState
        {
            public Camera Camera;
            public bool Enabled;
            public string Tag;
        }

        private struct LightState
        {
            public Light Light;
            public bool Enabled;
            public string Name;
        }

        private struct CaptureMetrics
        {
            public float Contrast;
            public float AverageChroma;
            public float AverageLuminance;
            public Color MeanColor;
        }

        private static void CaptureProfilesIfRequested()
        {
            string directory = Environment.GetEnvironmentVariable("ROA_LIGHTING_CAPTURE_DIR");
            if (string.IsNullOrWhiteSpace(directory)) return;
            Directory.CreateDirectory(directory);

            const int probeLayer = 30;
            int probeMask = 1 << probeLayer;
            var cameraStates = new List<CameraState>();
            var lightStates = new List<LightState>();
            GameObject sceneRoot = null;
            GameObject cameraObject = null;
            GameObject lightingHost = null;
            RenderTexture renderTarget = null;
            RenderTexture previousActive = RenderTexture.active;
            Material groundMaterial = null;
            Material roadMaterial = null;
            Material actorMaterial = null;
            Material leatherMaterial = null;
            Material steelMaterial = null;
            Material hazardMaterial = null;
            try
            {
                foreach (Camera existing in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsInactive.Include))
                {
                    if (existing == null) continue;
                    cameraStates.Add(new CameraState
                    {
                        Camera = existing,
                        Enabled = existing.enabled,
                        Tag = existing.gameObject.tag
                    });
                    existing.enabled = false;
                    if (existing.CompareTag("MainCamera")) existing.gameObject.tag = "Untagged";
                }
                foreach (Light existing in UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Include))
                {
                    if (existing == null) continue;
                    lightStates.Add(new LightState
                    {
                        Light = existing,
                        Enabled = existing.enabled,
                        Name = existing.name
                    });
                    existing.enabled = false;
                    if (existing.type == LightType.Directional && existing.name == "Directional Light")
                        existing.name = "Disabled Directional Light";
                }

                Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                if (shader == null) throw new InvalidOperationException("Lit shader не найден");
                groundMaterial = Material(shader, "Lighting probe ground", new Color(0.48f, 0.34f, 0.19f));
                roadMaterial = Material(shader, "Lighting probe road", new Color(0.69f, 0.51f, 0.29f));
                actorMaterial = Material(shader, "Lighting probe actor", new Color(0.055f, 0.068f, 0.064f));
                leatherMaterial = Material(shader, "Lighting probe leather", new Color(0.58f, 0.23f, 0.075f));
                steelMaterial = Material(shader, "Lighting probe steel", new Color(0.20f, 0.38f, 0.43f));
                hazardMaterial = Material(shader, "Lighting probe hazard", new Color(0.82f, 0.55f, 0.08f));

                sceneRoot = new GameObject("Lighting profile readability scene");
                sceneRoot.layer = probeLayer;
                GameObject ground = Primitive(PrimitiveType.Cube, sceneRoot.transform, probeLayer,
                    new Vector3(0f, -0.16f, 0f), new Vector3(30f, 0.24f, 30f),
                    Quaternion.identity, groundMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform, probeLayer,
                    new Vector3(0f, 0.04f, 0f), new Vector3(3.2f, 0.14f, 25f),
                    Quaternion.Euler(0f, 31f, 0f), roadMaterial);
                Primitive(PrimitiveType.Capsule, sceneRoot.transform, probeLayer,
                    new Vector3(0f, 1f, 0f), new Vector3(0.64f, 0.94f, 0.64f),
                    Quaternion.identity, actorMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform, probeLayer,
                    new Vector3(0.31f, 1.08f, 0.24f), new Vector3(0.44f, 0.78f, 0.30f),
                    Quaternion.Euler(0f, 25f, 0f), leatherMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform, probeLayer,
                    new Vector3(-0.43f, 0.86f, 0.18f), new Vector3(0.10f, 0.10f, 1.42f),
                    Quaternion.Euler(0f, 48f, -7f), steelMaterial);

                Primitive(PrimitiveType.Cylinder, sceneRoot.transform, probeLayer,
                    new Vector3(-4.5f, 0.62f, 2.7f), new Vector3(0.72f, 0.62f, 0.72f),
                    Quaternion.identity, steelMaterial);
                Primitive(PrimitiveType.Cylinder, sceneRoot.transform, probeLayer,
                    new Vector3(-3.35f, 0.52f, 3.15f), new Vector3(0.54f, 0.52f, 0.54f),
                    Quaternion.Euler(0f, 0f, 12f), hazardMaterial);
                Primitive(PrimitiveType.Cube, sceneRoot.transform, probeLayer,
                    new Vector3(4.6f, 0.72f, -3.4f), new Vector3(2.4f, 1.45f, 0.58f),
                    Quaternion.Euler(0f, -18f, 0f), actorMaterial);
                Primitive(PrimitiveType.Sphere, sceneRoot.transform, probeLayer,
                    new Vector3(5.2f, 0.28f, 3.8f), new Vector3(1.25f, 0.58f, 0.92f),
                    Quaternion.Euler(0f, 23f, 0f), roadMaterial);
                Primitive(PrimitiveType.Sphere, sceneRoot.transform, probeLayer,
                    new Vector3(-5.4f, 0.24f, -4.2f), new Vector3(0.92f, 0.48f, 1.18f),
                    Quaternion.Euler(0f, -31f, 0f), actorMaterial);

                cameraObject = new GameObject("Lighting profile camera");
                cameraObject.layer = probeLayer;
                cameraObject.tag = "MainCamera";
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = probeMask;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.allowHDR = true;
                camera.allowMSAA = true;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 120f;
                camera.fieldOfView = RoaCameraRig.GameplayFieldOfView;
                Quaternion orbit = Quaternion.Euler(55f, 45f, 0f);
                Vector3 focus = new Vector3(0f, 1f, 0f);
                camera.transform.position = focus - orbit * Vector3.forward
                    * RoaCameraRig.DefaultGameplayDistance;
                camera.transform.rotation = orbit;

                GameObject sunObject = new GameObject("Directional Light");
                sunObject.transform.SetParent(sceneRoot.transform, false);
                sunObject.layer = probeLayer;
                Light sun = sunObject.AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.cullingMask = probeMask;

                lightingHost = new GameObject("Lighting profile runtime");
                RoaWorldLighting lighting = lightingHost.AddComponent<RoaWorldLighting>();
                lighting.Sun = sun;
                if (lighting.Moon != null) lighting.Moon.cullingMask = probeMask;
                if (lighting.ReliefRim != null) lighting.ReliefRim.cullingMask = probeMask;
                lighting.FixedWorldHour = RoaWorldLighting.WebFixedWorldHour;
                Renderer groundRenderer = ground.GetComponent<Renderer>();

                renderTarget = new RenderTexture(960, 540, 24, RenderTextureFormat.ARGB32)
                {
                    name = "LightingProfileCapture"
                };
                renderTarget.Create();

                LocationDefinition[] locations =
                {
                    new LocationDefinition { Id = "probe_wasteland", Kind = "wasteland", Safe = true },
                    new LocationDefinition { Id = "probe_resource", Kind = "resource", Safe = true },
                    new LocationDefinition { Id = "probe_hostile", Kind = "lair", Safe = false, EncounterOnly = true }
                };
                string[] profileIds = { "wasteland_neutral", "resource_dust", "hostile_cold" };
                var profileMetrics = new CaptureMetrics[profileIds.Length];
                for (int i = 0; i < locations.Length; i++)
                {
                    lighting.SetLocation(locations[i], groundRenderer);
                    lighting.SetLocalWorldActive(true);
                    Require(lighting.VisualProfileId == profileIds[i],
                        "неверный визуальный профиль: " + lighting.VisualProfileId);
                    string path = Path.Combine(directory, profileIds[i] + ".png");
                    CaptureMetrics metrics = Capture(camera, renderTarget, path);
                    profileMetrics[i] = metrics;
                    Color groundColor = groundRenderer.sharedMaterial.HasProperty("_BaseColor")
                        ? groundRenderer.sharedMaterial.GetColor("_BaseColor")
                        : groundRenderer.sharedMaterial.color;
                    Debug.Log("[ДЕНЬ/НОЧЬ] кадр " + profileIds[i]
                        + ": contrast=" + metrics.Contrast.ToString("0.000")
                        + ", chroma=" + metrics.AverageChroma.ToString("0.000")
                        + ", luma=" + metrics.AverageLuminance.ToString("0.000")
                        + ", ground=" + ColorUtility.ToHtmlStringRGB(groundColor)
                        + ", " + path);
                    Require(metrics.Contrast > 0.08f && metrics.AverageChroma > 0.008f
                            && metrics.AverageChroma < 0.55f
                            && metrics.AverageLuminance < 0.66f,
                        profileIds[i] + " потерял тональное или цветовое разделение");
                }
                Require(ColorDistance(profileMetrics[1].MeanColor, profileMetrics[2].MeanColor) > 0.075f,
                    "ресурсная и опасная зоны снова выглядят одинаково");
                Require(ColorDistance(profileMetrics[0].MeanColor, profileMetrics[1].MeanColor) > 0.075f,
                    "нейтральная пустошь не отличается от ресурсной зоны");
            }
            finally
            {
                RenderTexture.active = previousActive;
                if (lightingHost != null) UnityEngine.Object.DestroyImmediate(lightingHost);
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (sceneRoot != null) UnityEngine.Object.DestroyImmediate(sceneRoot);
                if (renderTarget != null)
                {
                    renderTarget.Release();
                    UnityEngine.Object.DestroyImmediate(renderTarget);
                }
                if (groundMaterial != null) UnityEngine.Object.DestroyImmediate(groundMaterial);
                if (roadMaterial != null) UnityEngine.Object.DestroyImmediate(roadMaterial);
                if (actorMaterial != null) UnityEngine.Object.DestroyImmediate(actorMaterial);
                if (leatherMaterial != null) UnityEngine.Object.DestroyImmediate(leatherMaterial);
                if (steelMaterial != null) UnityEngine.Object.DestroyImmediate(steelMaterial);
                if (hazardMaterial != null) UnityEngine.Object.DestroyImmediate(hazardMaterial);
                foreach (LightState state in lightStates)
                {
                    if (state.Light == null) continue;
                    state.Light.name = state.Name;
                    state.Light.enabled = state.Enabled;
                }
                foreach (CameraState state in cameraStates)
                {
                    if (state.Camera == null) continue;
                    state.Camera.gameObject.tag = state.Tag;
                    state.Camera.enabled = state.Enabled;
                }
            }
        }

        private static CaptureMetrics Capture(Camera camera, RenderTexture target, string path)
        {
            RenderTexture previousTarget = camera.targetTexture;
            RenderTexture previousActive = RenderTexture.active;
            Texture2D readback = null;
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                readback = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());

                Color32[] pixels = readback.GetPixels32();
                int count = (pixels.Length + 3) / 4;
                var luminance = new float[count];
                float chroma = 0f;
                float luminanceSum = 0f;
                float red = 0f;
                float green = 0f;
                float blue = 0f;
                int sample = 0;
                for (int i = 0; i < pixels.Length; i += 4)
                {
                    Color32 pixel = pixels[i];
                    float r = pixel.r / 255f;
                    float g = pixel.g / 255f;
                    float b = pixel.b / 255f;
                    float value = r * 0.2126f + g * 0.7152f + b * 0.0722f;
                    luminance[sample++] = value;
                    luminanceSum += value;
                    red += r;
                    green += g;
                    blue += b;
                    chroma += Mathf.Max(r, Mathf.Max(g, b)) - Mathf.Min(r, Mathf.Min(g, b));
                }
                Array.Sort(luminance);
                int low = Mathf.Clamp(Mathf.FloorToInt((sample - 1) * 0.08f), 0, sample - 1);
                int high = Mathf.Clamp(Mathf.FloorToInt((sample - 1) * 0.92f), 0, sample - 1);
                return new CaptureMetrics
                {
                    Contrast = luminance[high] - luminance[low],
                    AverageChroma = sample > 0 ? chroma / sample : 0f,
                    AverageLuminance = sample > 0 ? luminanceSum / sample : 0f,
                    MeanColor = sample > 0
                        ? new Color(red / sample, green / sample, blue / sample)
                        : Color.black
                };
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
            }
        }

        private static float ColorDistance(Color a, Color b)
        {
            float r = a.r - b.r;
            float g = a.g - b.g;
            float blue = a.b - b.b;
            return Mathf.Sqrt(r * r + g * g + blue * blue);
        }

        private static Material Material(Shader shader, string name, Color color)
        {
            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.035f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.035f);
            return material;
        }

        private static GameObject Primitive(PrimitiveType type, Transform parent, int layer,
                                            Vector3 position, Vector3 scale,
                                            Quaternion rotation, Material material)
        {
            GameObject value = GameObject.CreatePrimitive(type);
            value.name = "Lighting readability " + type;
            value.layer = layer;
            value.transform.SetParent(parent, false);
            value.transform.position = position;
            value.transform.localScale = scale;
            value.transform.rotation = rotation;
            Renderer renderer = value.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = material;
            return value;
        }
        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static Color Html(string value)
        {
            Color color;
            if (!ColorUtility.TryParseHtmlString(value, out color))
                throw new InvalidOperationException("Некорректный цвет теста: " + value);
            return color;
        }

        private static bool ApproximatelyColor(Color a, Color b)
        {
            return Mathf.Abs(a.r - b.r) < 0.001f
                && Mathf.Abs(a.g - b.g) < 0.001f
                && Mathf.Abs(a.b - b.b) < 0.001f;
        }
    }
}
#endif
