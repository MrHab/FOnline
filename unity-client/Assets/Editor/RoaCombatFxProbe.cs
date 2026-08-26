#if UNITY_EDITOR
using System;
using System.Collections.Generic;
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
                    + ", runtime=speculative-shot/confirmed-miss-hit/layered-explosion/world-overlay/clear");
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
                        && fx.ActiveImpactCount == 0,
                        "speculative shots created a false impact before server confirmation");
                LineRenderer[] lines = root.GetComponentsInChildren<LineRenderer>(true);
                Require(Array.FindAll(lines, line => line.gameObject.activeInHierarchy
                        && line.gameObject.name == "PolishedTracerFx" && line.positionCount == 2).Length == 5,
                        "moving tapered tracer geometry is incomplete");
                MeshFilter[] bursts = root.GetComponentsInChildren<MeshFilter>(true);
                Require(Array.FindAll(bursts, burst => burst.gameObject.activeInHierarchy
                        && burst.sharedMesh != null && burst.sharedMesh.name == "ProceduralMuzzleBurst").Length == 5,
                        "directional muzzle burst geometry is incomplete");

                Vector3 missSource = new Vector3(-4f, 0f, -1f);
                Vector3 missTarget = new Vector3(2f, 0f, 3f);
                Vector3 missA = RoaCombatFx.ResolveMissPoint(
                    missSource, missTarget, "probe-attack-a", 1.1f);
                Vector3 missAgain = RoaCombatFx.ResolveMissPoint(
                    missSource, missTarget, "probe-attack-a", 1.1f);
                Vector3 missB = RoaCombatFx.ResolveMissPoint(
                    missSource, missTarget, "probe-attack-b", 1.1f);
                Require(Vector3.Distance(missA, missAgain) < 0.0001f
                        && Vector2.Distance(new Vector2(missA.x, missA.z),
                                            new Vector2(missTarget.x, missTarget.z)) > 0.72f
                        && Vector3.Distance(missA, missB) > 0.04f,
                        "miss endpoint is not deterministic or remains inside the target silhouette");
                fx.PlayMiss(missA, missSource, "machineGun");
                Require(fx.ActiveImpactCount == 1,
                        "server-confirmed miss did not activate a separate ground impact");
                Transform missImpact = Array.Find(root.GetComponentsInChildren<Transform>(true), item =>
                    item.gameObject.activeInHierarchy && item.gameObject.name == "LayeredImpactFx");
                Require(missImpact != null && Vector3.Distance(missImpact.position, missA) < 0.001f,
                        "miss ground impact was not placed at the resolved endpoint");

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
                VerifyWorldOverlay(root, camera);

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

        private static void VerifyWorldOverlay(GameObject root, Camera camera)
        {
            RoaWorldOverlayCanvas overlay = root.AddComponent<RoaWorldOverlayCanvas>();
            overlay.Configure(null, null, camera);
            var ground = new List<RoaWorldOverlayCanvas.GroundLabel>
            {
                new RoaWorldOverlayCanvas.GroundLabel
                {
                    Id = "ground-ammo", ItemId = "ammo9", Quantity = 3,
                    World = new Vector3(1.25f, 0.5f, 0f), DistanceSquared = 0.25f
                },
                new RoaWorldOverlayCanvas.GroundLabel
                {
                    Id = "ground-scrap", ItemId = "scrap", Quantity = 2,
                    World = new Vector3(1.25f, 0.5f, 0f), DistanceSquared = 0.5f
                }
            };
            var speech = new List<RoaCombatFx.SpeechBubble>
            {
                new RoaCombatFx.SpeechBubble
                {
                    Id = "npc-a", Text = "Держись ближе к укрытию.",
                    World = new Vector3(1.25f, 0.5f, 0f), Opacity = 1f
                },
                new RoaCombatFx.SpeechBubble
                {
                    Id = "npc-b", Text = "Слышу движение впереди.",
                    World = new Vector3(1.25f, 0.5f, 0f), Opacity = 0.8f
                }
            };

            overlay.PresentNow(ground, speech, "Рядом ничего нет", 1f);
            Require(overlay.CanvasReady && overlay.InputTransparent
                    && overlay.GroundPoolSize == 8 && overlay.SpeechPoolSize == 6,
                    "world overlay Canvas, fixed pools or input transparency is incomplete");
            Require(overlay.ActiveGroundCount == 2 && overlay.ActiveSpeechCount == 2
                    && overlay.StatusVisible,
                    "world overlay did not present ground labels, speech and status together");

            Text[] activeText = Array.FindAll(root.GetComponentsInChildren<Text>(true),
                item => item.gameObject.activeInHierarchy);
            string localizedAmmo = RoaItemData.Name("ammo9");
            Require(Array.Exists(activeText, item => item.text.Contains(localizedAmmo))
                    && !Array.Exists(activeText, item => item.text.Contains("ammo9"))
                    && Array.FindAll(activeText, item => item.text.Contains("ПОДНЯТЬ")).Length == 1,
                    "ground overlay exposes raw ids or marks more than the nearest item as actionable");
            Require(Array.Exists(activeText, item => item.text == "Держись ближе к укрытию.")
                    && Array.Exists(activeText, item => item.text == "Слышу движение впереди.")
                    && Array.Exists(activeText, item => item.text == "Рядом ничего нет"),
                    "world overlay lost NPC speech or short pickup status");

            RectTransform[] views = Array.FindAll(root.GetComponentsInChildren<RectTransform>(true),
                item => item.gameObject.activeInHierarchy
                    && (item.gameObject.name == "GroundItemLabel"
                        || item.gameObject.name == "WorldSpeechBubble"));
            Require(views.Length == 4 && views[0].anchoredPosition.x > 0f,
                    "world overlay did not project visible world points into the Canvas");
            for (int i = 0; i < views.Length; i++)
            {
                Rect a = CenteredRect(views[i]);
                for (int j = i + 1; j < views.Length; j++)
                    Require(!a.Overlaps(CenteredRect(views[j])),
                            "world overlay labels overlap at a shared world position");
            }

            var overflowGround = new List<RoaWorldOverlayCanvas.GroundLabel>();
            var overflowSpeech = new List<RoaCombatFx.SpeechBubble>();
            for (int i = 0; i < 14; i++)
            {
                float x = -3f + (i % 7);
                float z = i < 7 ? -1.5f : 1.5f;
                overflowGround.Add(new RoaWorldOverlayCanvas.GroundLabel
                {
                    Id = "ground-overflow-" + i, ItemId = "scrap", Quantity = 1,
                    World = new Vector3(x, 0.5f, z), DistanceSquared = i + 1f
                });
                overflowSpeech.Add(new RoaCombatFx.SpeechBubble
                {
                    Id = "speech-overflow-" + i, Text = "Реплика " + i,
                    World = new Vector3(x, 0.5f, z), Opacity = 1f
                });
            }
            overlay.PresentNow(overflowGround, overflowSpeech, string.Empty, 0f);
            Require(overlay.GroundPoolSize == 8 && overlay.SpeechPoolSize == 6
                    && overlay.ActiveGroundCount <= 8 && overlay.ActiveSpeechCount <= 6,
                    "world overlay grew beyond its fixed runtime pools");
            overlay.Clear();
            Require(overlay.ActiveGroundCount == 0 && overlay.ActiveSpeechCount == 0
                    && !overlay.StatusVisible,
                    "world overlay pools did not clear cleanly");
        }

        private static Rect CenteredRect(RectTransform transform)
        {
            Vector2 size = transform.rect.size;
            Vector2 center = transform.anchoredPosition;
            return new Rect(center - size * 0.5f, size);
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
