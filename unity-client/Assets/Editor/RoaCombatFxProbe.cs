#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaCombatFxProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить боевые эффекты";
        private const string RequestName = "RoaCombatFxProbe.request";
        private static double _nextRequestCheck;

        static RoaCombatFxProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(projectRoot)) return;
            string request = Path.Combine(projectRoot, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                RoaCombatFx.WeaponFxProfile laser = RoaCombatFx.ProfileFor("laserPistol");
                RoaCombatFx.WeaponFxProfile plasma = RoaCombatFx.ProfileFor("plasmaRifle");
                RoaCombatFx.WeaponFxProfile fallback = RoaCombatFx.ProfileFor("unknown");
                Require(ColorNear(laser.Tracer, Hex("#ff5b84")) && Near(laser.TracerLife, 0.22f),
                        "laser profile differs from web client");
                Require(ColorNear(plasma.Tracer, Hex("#75ffa8")) && Near(plasma.FlashLife, 0.10f),
                        "plasma profile differs from web client");
                Require(ColorNear(fallback.Tracer, Hex("#ffd56a")) && Near(fallback.TracerLife, 0.16f),
                        "default firearm profile differs from web client");

                var exact = new JObject
                {
                    ["startX"] = 2f,
                    ["startY"] = 1.05f,
                    ["startZ"] = 3f,
                    ["endX"] = 8f,
                    ["endZ"] = -4f
                };
                Vector3 start;
                Vector3 end;
                Require(RoaCombatFx.TryShotEndpoints(exact, out start, out end),
                        "exact shot endpoints were rejected");
                Require(Near(start.x, 2f) && Near(start.z, -3f)
                        && Near(end.x, 8f) && Near(end.z, 4f),
                        "shot endpoints lost the server-to-Unity Z inversion");

                var directional = new JObject
                {
                    ["originX"] = -1f,
                    ["originZ"] = 2f,
                    ["dirX"] = 1f,
                    ["dirZ"] = 0f,
                    ["endDist"] = 5f
                };
                Require(RoaCombatFx.TryShotEndpoints(directional, out start, out end)
                        && Near(end.x, 4f) && Near(end.z, -2f),
                        "directional shot fallback has an incorrect endpoint");

                VerifyRuntimeVisuals();

                Debug.Log("[БОЕВЫЕ ЭФФЕКТЫ] готово: laser=" + laser.TracerLife.ToString("0.00")
                    + "s, plasma=" + plasma.TracerLife.ToString("0.00")
                    + "s, Z=" + start.z.ToString("0.0") + "→" + end.z.ToString("0.0")
                    + ", runtime=moving-tracer/muzzle/sparks/layered-explosion/clear");
            }
            catch (Exception error)
            {
                Debug.LogError("[БОЕВЫЕ ЭФФЕКТЫ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static bool Near(float a, float b)
        {
            return Mathf.Abs(a - b) < 0.0001f;
        }

        private static bool ColorNear(Color a, Color b)
        {
            return Near(a.r, b.r) && Near(a.g, b.g) && Near(a.b, b.b);
        }

        private static Color Hex(string value)
        {
            Color color;
            if (!ColorUtility.TryParseHtmlString(value, out color))
                throw new InvalidOperationException("invalid test color " + value);
            return color;
        }

        private static void VerifyRuntimeVisuals()
        {
            var root = new GameObject("Combat FX probe");
            var cameraRoot = new GameObject("Combat damage camera", typeof(Camera));
            try
            {
                Camera camera = cameraRoot.GetComponent<Camera>();
                cameraRoot.tag = "MainCamera";
                cameraRoot.transform.position = new Vector3(0f, 12f, -10f);
                cameraRoot.transform.LookAt(Vector3.zero);
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.035f, 0.045f, 0.04f, 1f);

                RoaCombatFx fx = root.AddComponent<RoaCombatFx>();
                RoaCombatPresentationFx polish = root.AddComponent<RoaCombatPresentationFx>();
                fx.Polish = polish;
                for (int i = 0; i < 5; i++)
                    fx.PlayShot(new Vector3(i, 1.1f, 0f), new Vector3(i + 6f, 1.1f, 2f),
                                i % 2 == 0 ? "machineGun" : "laserPistol");
                Require(fx.ActiveTracerCount == 5 && fx.ActiveFlashCount == 5
                        && fx.ActiveImpactCount == 5,
                        "automatic queue did not activate five pooled tracer/flash/impact sets");
                LineRenderer[] lines = root.GetComponentsInChildren<LineRenderer>(true);
                Require(Array.FindAll(lines, line => line.gameObject.activeInHierarchy
                        && line.gameObject.name == "PolishedTracerFx" && line.positionCount == 2).Length == 5,
                        "moving tapered tracer geometry is incomplete");
                MeshFilter[] bursts = root.GetComponentsInChildren<MeshFilter>(true);
                Require(Array.FindAll(bursts, burst => burst.gameObject.activeInHierarchy
                        && burst.sharedMesh != null && burst.sharedMesh.name == "ProceduralMuzzleBurst").Length == 5,
                        "directional muzzle burst geometry is incomplete");

                fx.PlayExplosion(new Vector3(2f, 0f, -3f), 4.2f);
                Require(fx.ActiveExplosionCount == 1,
                        "rocket explosion visual was not created");
                Transform explosion = root.transform.Find("PolishedExplosionFx");
                Require(explosion != null && explosion.GetComponent<Light>() != null
                        && explosion.Find("Shockwave") != null
                        && explosion.Find("HeatRing") != null
                        && explosion.Find("FireballCore") != null
                        && explosion.Find("FireballGlow") != null
                        && explosion.Find("Smoke0") != null
                        && explosion.Find("Ember0") != null,
                        "rocket explosion is missing a shock, heat, fireball, smoke or ember layer");

                Vector3 target = Vector3.zero;
                Vector3 source = new Vector3(6f, 0f, 1f);
                Require(RoaCombatPresentationFx.TryDamageScreenDirection(camera, target, source,
                            out Vector2 screenDirection) && screenDirection.x > 0.7f,
                        "world damage source did not project to the correct screen side");
                polish.PlayDamagePulse(34, target, source);
                MethodInfo refresh = typeof(RoaCombatPresentationFx).GetMethod("UpdateDamageFeedback",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(refresh != null, "damage feedback refresh method is missing");
                refresh.Invoke(polish, new object[] { Time.unscaledTime });
                RawImage[] feedback = root.GetComponentsInChildren<RawImage>(true);
                Require(polish.DamageCanvasReady && polish.DamageDirectionVisible
                        && feedback.Length == 2
                        && Array.TrueForAll(feedback, image => !image.raycastTarget),
                        "damage Canvas, direction marker or input transparency is incomplete");
                CaptureDamageIfRequested(feedback, screenDirection);

                fx.Clear();
                Require(fx.ActiveTracerCount == 0 && fx.ActiveFlashCount == 0
                        && fx.ActiveImpactCount == 0 && fx.ActiveExplosionCount == 0,
                        "combat visual pools did not clear cleanly");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(cameraRoot);
            }
        }

        private static void CaptureDamageIfRequested(RawImage[] feedback, Vector2 screenDirection)
        {
            string path = Environment.GetEnvironmentVariable("ROA_COMBAT_DAMAGE_CAPTURE");
            if (string.IsNullOrWhiteSpace(path) || feedback == null) return;
            RawImage vignetteView = Array.Find(feedback, image => image.gameObject.name == "Vignette");
            RawImage directionView = Array.Find(feedback, image => image.gameObject.name == "SourceDirection");
            Texture2D vignette = vignetteView?.texture as Texture2D;
            Texture2D arrow = directionView?.texture as Texture2D;
            if (vignette == null || arrow == null) return;

            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            const int width = 1280;
            const int height = 720;
            var output = new Texture2D(width, height, TextureFormat.RGBA32, false);
            var pixels = new Color32[width * height];
            var background = new Color32(14, 21, 18, 255);
            for (int i = 0; i < pixels.Length; i++) pixels[i] = background;

            Color32[] vignettePixels = vignette.GetPixels32();
            for (int y = 0; y < height; y++)
            {
                int sy = Mathf.Min(vignette.height - 1, y * vignette.height / height);
                for (int x = 0; x < width; x++)
                {
                    int sx = Mathf.Min(vignette.width - 1, x * vignette.width / width);
                    int index = y * width + x;
                    pixels[index] = Blend(pixels[index], vignettePixels[sy * vignette.width + sx],
                                          vignetteView.color.a);
                }
            }

            Color32[] arrowPixels = arrow.GetPixels32();
            Vector2 center = new Vector2(width * 0.5f, height * 0.5f)
                + screenDirection * (Mathf.Min(width, height) * 0.235f);
            float scale = directionView.rectTransform.localScale.x;
            Vector2 size = directionView.rectTransform.sizeDelta * scale;
            float angle = (Mathf.Atan2(screenDirection.y, screenDirection.x) * Mathf.Rad2Deg - 90f)
                * Mathf.Deg2Rad;
            float cos = Mathf.Cos(angle);
            float sin = Mathf.Sin(angle);
            int bound = Mathf.CeilToInt(Mathf.Max(size.x, size.y));
            for (int y = Mathf.Max(0, Mathf.FloorToInt(center.y) - bound);
                 y <= Mathf.Min(height - 1, Mathf.CeilToInt(center.y) + bound); y++)
            {
                for (int x = Mathf.Max(0, Mathf.FloorToInt(center.x) - bound);
                     x <= Mathf.Min(width - 1, Mathf.CeilToInt(center.x) + bound); x++)
                {
                    float dx = x + 0.5f - center.x;
                    float dy = y + 0.5f - center.y;
                    float localX = cos * dx + sin * dy;
                    float localY = -sin * dx + cos * dy;
                    float u = localX / size.x + 0.5f;
                    float v = localY / size.y + 0.5f;
                    if (u < 0f || u > 1f || v < 0f || v > 1f) continue;
                    int sx = Mathf.Clamp(Mathf.FloorToInt(u * arrow.width), 0, arrow.width - 1);
                    int sy = Mathf.Clamp(Mathf.FloorToInt(v * arrow.height), 0, arrow.height - 1);
                    Color32 source = arrowPixels[sy * arrow.width + sx];
                    source.r = (byte)Mathf.RoundToInt(source.r * directionView.color.r);
                    source.g = (byte)Mathf.RoundToInt(source.g * directionView.color.g);
                    source.b = (byte)Mathf.RoundToInt(source.b * directionView.color.b);
                    pixels[y * width + x] = Blend(pixels[y * width + x], source,
                                                  directionView.color.a);
                }
            }

            output.SetPixels32(pixels);
            output.Apply(false, false);
            File.WriteAllBytes(path, output.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(output);
        }

        private static Color32 Blend(Color32 background, Color32 foreground, float alphaMultiplier)
        {
            float alpha = foreground.a / 255f * Mathf.Clamp01(alphaMultiplier);
            return new Color32(
                (byte)Mathf.RoundToInt(Mathf.Lerp(background.r, foreground.r, alpha)),
                (byte)Mathf.RoundToInt(Mathf.Lerp(background.g, foreground.g, alpha)),
                (byte)Mathf.RoundToInt(Mathf.Lerp(background.b, foreground.b, alpha)),
                255);
        }
    }
}
#endif
