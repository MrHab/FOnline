#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Земля зон на бесшовных наборах (шейдер Kromka Ground, RoaGroundTextures). Для
    /// каждого зонального пресета грунта строится клочок земли с тропой, водой и гарью
    /// и снимается с игровой камеры сухим и мокрым; один кадр — прежней землёй URP/Lit
    /// для сравнения. Проверяется: шейдер собран (нет пурпурных пикселей), маска
    /// поверхности несёт тропу и воду, набор даёт деталь (разброс яркости выше прежней
    /// земли), мокрая земля темнее сухой. Кадры — Library/GroundTexturesProbe.
    /// </summary>
    public static class RoaGroundTexturesProbe
    {
        private const string Tag = "[ТЕКСТУРЫ ЗЕМЛИ]";
        private const int CaptureLayer = 30;
        private const int Width = 640;
        private const int Height = 400;
        private static readonly int WetnessId = Shader.PropertyToID("_Wetness");
        private static readonly int PuddlesId = Shader.PropertyToID("_Puddles");
        private static readonly int MudId = Shader.PropertyToID("_Mud");
        private static readonly int RainId = Shader.PropertyToID("_Rain");

        public static readonly string[] ZonePresets =
        {
            "tract_dust", "river_loam", "chalk", "zero_soil", "iron_scree", "fused_soil", "wet_concrete", "silent_ring"
        };

        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/GroundTexturesProbe"));

        [MenuItem("Realm of Ashes/Погода/Проверить текстуры земли")]
        public static void Run()
        {
            Directory.CreateDirectory(Output);
            var lines = new List<string>();
            try
            {
                Require(RoaGroundTextures.Available, "шейдер Kromka Ground или каталог текстур земли недоступен");
                foreach (string preset in ZonePresets)
                {
                    string set = RoaGroundTextures.SetForPreset(preset);
                    Require(!string.IsNullOrEmpty(set) && set != RoaGroundTextures.PathSet,
                        "у пресета " + preset + " нет своего набора");
                }

                Shot legacy = Capture("legacy", "tract_dust", 0f, true);
                // Телефон: облегчённый вариант шейдера тоже обязан собраться.
                Shot lite = Capture("tract_dust-lite", "tract_dust", 0f, false, true);
                Require(lite.Magenta < 0.0001f && lite.Detail > legacy.Detail, "облегчённый шейдер земли не собран");
                foreach (string preset in ZonePresets)
                {
                    Shot dry = Capture(preset, preset, 0f, false);
                    Shot wet = Capture(preset + "-wet", preset, 1f, false);
                    Shot storm = Capture(preset + "-storm", preset, 1f, false, false, true);
                    float changed = ChangedFraction(wet, storm);
                    lines.Add(preset + ": " + RoaGroundTextures.SetForPreset(preset)
                        + " lum " + dry.Luminance.ToString("0.000") + "/" + wet.Luminance.ToString("0.000")
                        + " detail " + dry.Detail.ToString("0.000") + " puddles+mud " + changed.ToString("0.00"));
                    // Лужи и грязь меняют заметную часть кадра, но не заливают его целиком.
                    Require(changed > 0.06f && changed < 0.85f,
                        preset + ": лужи и грязь не проявились или залили всё: " + changed.ToString("0.00"));
                    Require(storm.Magenta < 0.0001f, preset + ": шейдер луж не собран (пурпур)");
                    Require(dry.Magenta < 0.0001f && wet.Magenta < 0.0001f, preset + ": шейдер земли не собран (пурпур)");
                    Require(dry.Detail > legacy.Detail * 1.25f,
                        preset + ": набор не даёт детали: " + dry.Detail.ToString("0.000") + " против " + legacy.Detail.ToString("0.000"));
                    Require(wet.Luminance < dry.Luminance * 0.92f, preset + ": мокрая земля не темнее сухой");
                }
                Debug.Log(Tag + " готово: " + ZonePresets.Length + " грунтов, прежняя земля detail "
                    + legacy.Detail.ToString("0.000") + " | " + string.Join(" | ", lines) + " — кадры: " + Output);
            }
            catch (Exception error)
            {
                Debug.LogError(Tag + " ошибка: " + error.Message + (lines.Count > 0 ? " | " + string.Join(" | ", lines) : string.Empty));
                throw;
            }
        }

        public static void RunBatch()
        {
            int code = 0;
            try { Run(); }
            catch (Exception) { code = 1; }
            EditorApplication.Exit(code);
        }

        internal struct Shot
        {
            public Color32[] Pixels;
            public float Luminance;
            public float Detail;
            public float Magenta;
        }

        private static Shot Capture(string name, string preset, float wetness, bool legacy, bool lite = false,
                                    bool storm = false)
        {
            GameObject host = new GameObject("GroundTexturesProbe_" + name);
            try
            {
                RoaGroundTextures.ForceLegacy = legacy;
                LocationDefinition location = Location("probe_" + preset, 18, 18, 52917L, preset);
                RoaLocalTerrain terrain = host.AddComponent<RoaLocalTerrain>();
                terrain.Initialize(location, Map(18, 18));
                Require(terrain.UsesGroundTextures != legacy, name + ": не тот материал земли");
                if (!legacy)
                {
                    Color32[] mask = terrain.SurfaceMaskTexture.GetPixels32();
                    int path = 0, water = 0, scorch = 0;
                    foreach (Color32 pixel in mask)
                    {
                        if (pixel.r > 128) path++;
                        if (pixel.g > 128) scorch++;
                        if (pixel.b > 128) water++;
                    }
                    Require(path > 100 && water > 100 && scorch > 100,
                        name + ": маска поверхности без тропы, воды или гари (" + path + "/" + water + "/" + scorch + ")");
                    if (lite) terrain.GroundRenderer.sharedMaterial.EnableKeyword(RoaGroundTextures.LiteKeyword);
                    var block = new MaterialPropertyBlock();
                    terrain.GroundRenderer.GetPropertyBlock(block);
                    block.SetFloat(WetnessId, wetness);
                    // Ливень: полные лужи и грязь, круги от капель.
                    block.SetFloat(PuddlesId, storm ? 1f : 0f);
                    block.SetFloat(MudId, storm ? 1f : 0f);
                    block.SetFloat(RainId, storm ? 1f : 0f);
                    terrain.GroundRenderer.SetPropertyBlock(block);
                }
                return Render(host, name);
            }
            finally
            {
                RoaGroundTextures.ForceLegacy = false;
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        internal static LocationDefinition Location(string id, int width, int depth, long seed, string preset)
        {
            return new LocationDefinition
            {
                Id = id,
                Seed = seed,
                RuntimeMode = "procedural",
                Ground = new GroundDefinition { Preset = preset },
                Map = new MapDefinition
                {
                    Width = width * 2,
                    Depth = depth * 2,
                    TechnicalWidth = width * 2,
                    TechnicalDepth = depth * 2,
                    Origin = "center"
                },
                Grid = new GridDefinition { Step = 2f },
                Spawn = new TileCoord { Tx = width / 2, Tz = depth / 2 },
                EntryFromWorld = new TileCoord { Tx = width / 2, Tz = depth / 2 + 1 },
                Exit = new LocationTransition { Tx = width - 2, Tz = depth / 2, Radius = 1.5f }
            };
        }

        /// <summary>Тропа наискосок через центр, озерцо слева и пятна гари справа.</summary>
        internal static JArray Map(int width, int depth)
        {
            var map = new JArray();
            for (int z = 0; z < depth; z++)
            {
                var row = new JArray();
                for (int x = 0; x < width; x++) row.Add(0);
                map.Add(row);
            }
            for (int z = 0; z < depth; z++)
            {
                int x = Mathf.Clamp(width / 2 + (z - depth / 2) / 2, 0, width - 1);
                ((JArray)map[z])[x] = 5;
                if (x + 1 < width) ((JArray)map[z])[x + 1] = 5;
            }
            for (int z = depth / 2 - 2; z <= depth / 2 + 1; z++)
            for (int x = 3; x <= 5; x++) ((JArray)map[z])[x] = 3;
            for (int z = depth / 2 - 1; z <= depth / 2 + 2; z += 1)
                ((JArray)map[z])[width - 5] = 4;
            return map;
        }

        private static Shot Render(GameObject host, string name)
        {
            return Render(host, name, Output, 11.5f, Width, Height);
        }

        /// <summary>
        /// Кадр клочка земли игровой камерой (55°, дистанция distance) в папку output;
        /// topDown — ортографически строго сверху, distance — половина стороны кадра в метрах
        /// (верх кадра — +Z, право — +X).
        /// </summary>
        internal static Shot Render(GameObject host, string name, string output, float distance, int width, int height,
                                    bool topDown = false)
        {
            foreach (Transform part in host.GetComponentsInChildren<Transform>(true))
                part.gameObject.layer = CaptureLayer;

            RenderTexture previous = RenderTexture.active;
            RenderTexture target = null;
            Texture2D readback = null;
            GameObject cameraObject = null;
            GameObject sunObject = null;
            AmbientMode previousAmbient = RenderSettings.ambientMode;
            Color previousAmbientLight = RenderSettings.ambientLight;
            SphericalHarmonicsL2 previousProbe = RenderSettings.ambientProbe;
            bool previousFog = RenderSettings.fog;
            Light[] sceneLights = Array.FindAll(
                UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude),
                light => light.enabled);
            try
            {
                foreach (Light light in sceneLights) light.enabled = false;
                RenderSettings.fog = false;
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.34f, 0.33f, 0.31f);
                var probe = new SphericalHarmonicsL2();
                probe.AddAmbientLight(RenderSettings.ambientLight);
                RenderSettings.ambientProbe = probe;

                // Солнце как в Wasteland около 16 часов: косое, тёплое, с тенями.
                sunObject = new GameObject("GroundTexturesProbeSun");
                Light sun = sunObject.AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.color = new Color(1f, 0.9f, 0.76f);
                sun.intensity = 1.05f;
                sun.shadows = LightShadows.Soft;
                sunObject.transform.rotation = Quaternion.Euler(38f, -40f, 0f);

                cameraObject = new GameObject("GroundTexturesProbeCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.cullingMask = 1 << CaptureLayer;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.34f, 0.37f, 0.40f);
                camera.fieldOfView = 52f;
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 120f;
                Quaternion orbit = topDown ? Quaternion.Euler(90f, 0f, 0f) : Quaternion.Euler(55f, 45f, 0f);
                cameraObject.transform.rotation = orbit;
                cameraObject.transform.position = new Vector3(0f, 0f, 0f) - orbit * Vector3.forward * (topDown ? 30f : distance);
                if (topDown)
                {
                    camera.orthographic = true;
                    camera.orthographicSize = distance;
                    camera.aspect = width / (float)height;
                }

                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
                target.Create();
                camera.targetTexture = target;
                for (int warmup = 0; warmup < 6; warmup++)
                {
                    RenderCapture(camera, target);
                    if (!ShaderUtil.anythingCompiling) break;
                    System.Threading.Thread.Sleep(300);
                }
                RenderCapture(camera, target);
                RenderTexture.active = target;
                readback = new Texture2D(width, height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(Path.Combine(output, name + ".png"), readback.EncodeToPNG());
                return Measure(readback.GetPixels32(), width, height);
            }
            finally
            {
                RenderSettings.ambientMode = previousAmbient;
                RenderSettings.ambientLight = previousAmbientLight;
                RenderSettings.ambientProbe = previousProbe;
                RenderSettings.fog = previousFog;
                foreach (Light light in sceneLights) if (light != null) light.enabled = true;
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (sunObject != null) UnityEngine.Object.DestroyImmediate(sunObject);
            }
        }

        private static void RenderCapture(Camera camera, RenderTexture target)
        {
            if (GraphicsSettings.currentRenderPipeline != null)
                RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
            else camera.Render();
        }

        /// <summary>Средняя яркость, «деталь» — средний перепад яркости соседних пикселей, доля пурпура.</summary>
        private static Shot Measure(Color32[] pixels, int width, int height)
        {
            double sum = 0, detail = 0;
            int magenta = 0, pairs = 0;
            for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                Color32 c = pixels[y * width + x];
                float lum = (0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b) / 255f;
                sum += lum;
                if (c.r > 200 && c.b > 200 && c.g < 60) magenta++;
                if (x + 1 < width)
                {
                    Color32 n = pixels[y * width + x + 1];
                    detail += Mathf.Abs(lum - (0.2126f * n.r + 0.7152f * n.g + 0.0722f * n.b) / 255f);
                    pairs++;
                }
            }
            return new Shot
            {
                Pixels = pixels,
                Luminance = (float)(sum / pixels.Length),
                Detail = (float)(detail / Math.Max(1, pairs)) * 100f,
                Magenta = magenta / (float)pixels.Length
            };
        }

        /// <summary>Доля пикселей, у которых яркость ушла больше чем на 0,06 между двумя кадрами.</summary>
        internal static float ChangedFraction(Shot a, Shot b)
        {
            int changed = 0;
            for (int i = 0; i < a.Pixels.Length; i++)
            {
                Color32 x = a.Pixels[i], y = b.Pixels[i];
                float lx = (0.2126f * x.r + 0.7152f * x.g + 0.0722f * x.b) / 255f;
                float ly = (0.2126f * y.r + 0.7152f * y.g + 0.0722f * y.b) / 255f;
                if (Mathf.Abs(lx - ly) > 0.06f) changed++;
            }
            return changed / (float)a.Pixels.Length;
        }

        internal static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
