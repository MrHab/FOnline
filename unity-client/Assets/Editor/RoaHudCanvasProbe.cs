#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.EditorTools
{
    public static class RoaHudCanvasProbe
    {
        [MenuItem("Realm of Ashes/Probe/Adaptive HUD")]
        public static void Run()
        {
            var occupied = new List<Rect>();
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect first),
                    "first nameplate was not placed");
            Require(first.xMin >= 6f && first.yMin >= 6f && first.xMax <= 794f && first.yMax <= 474f,
                    "nameplate escaped the screen safe margin");
            occupied.Add(first);
            Require(RoaActorNameplates.TryResolveScreenRect(new Vector2(-20f, -10f), occupied,
                                                            800, 480, out Rect second),
                    "overlapping nameplate was not relocated");
            Require(!first.Overlaps(second), "relocated nameplates still overlap");
            Require(typeof(RoaHudCanvas).IsSubclassOf(typeof(MonoBehaviour)),
                    "adaptive HUD is not a Unity component");
            Vector2 desktopReference = RoaUiScale.ReferenceFor(false);
            Vector2 mobileReference = RoaUiScale.ReferenceFor(true);
            Require(desktopReference == new Vector2(1600f, 900f),
                    "desktop UI reference no longer protects laptop readability");
            Require(mobileReference == new Vector2(1280f, 720f),
                    "mobile UI reference changed unexpectedly");
            RoaHudCanvas.ConnectionBannerState interrupted = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Disconnected, 3, 4.2f, string.Empty, false);
            Require(interrupted.Kind == RoaHudCanvas.ConnectionBannerKind.Interrupted
                    && interrupted.Title.Contains("ПОТЕРЯНА")
                    && interrupted.Detail.Contains("5 с")
                    && interrupted.Detail.Contains("3"),
                "offline banner lost retry countdown or attempt number");
            RoaHudCanvas.ConnectionBannerState connecting = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Connecting, 2, 0f, string.Empty, false);
            Require(connecting.Kind == RoaHudCanvas.ConnectionBannerKind.Connecting
                    && connecting.Detail.Contains("2"),
                "connecting banner no longer explains the current attempt");
            RoaHudCanvas.ConnectionBannerState synchronizing = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joining, 2, 0f, string.Empty, false);
            Require(synchronizing.Kind == RoaHudCanvas.ConnectionBannerKind.Synchronizing,
                "join recovery is not presented as world synchronization");
            RoaHudCanvas.ConnectionBannerState restored = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joined, 0, 0f, string.Empty, true);
            Require(restored.Kind == RoaHudCanvas.ConnectionBannerKind.Restored,
                "successful reconnect has no confirmation");
            RoaHudCanvas.ConnectionBannerState healthy = RoaHudCanvas.DescribeConnection(
                RoaSocketClient.ConnectionPhase.Joined, 0, 0f, string.Empty, false);
            Require(healthy.Kind == RoaHudCanvas.ConnectionBannerKind.Hidden,
                "healthy connection leaves a permanent banner on screen");
            CaptureIfRequested();
            Debug.Log("[ROA PROBE] Adaptive HUD OK: safe nameplates, readable desktop scale and Canvas owner.");
        }

        private static void CaptureIfRequested()
        {
            string path = Environment.GetEnvironmentVariable("ROA_HUD_CAPTURE");
            if (string.IsNullOrWhiteSpace(path)) return;
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("HudCanvasCapture");
                RoaHud hud = host.AddComponent<RoaHud>();
                Set(hud, "_selfId", "capture-player");
                Set(hud, "_name", "Странник");
                Set(hud, "_hp", 74);
                Set(hud, "_maxHp", 100);
                Set(hud, "_ap", 7f);
                Set(hud, "_maxAp", 10);
                Set(hud, "_level", 8);
                Set(hud, "_xp", 630);
                Set(hud, "_xpNeeded", 1000);
                Set(hud, "_weapon", "fists");
                Set(hud, "_armorThreshold", 4);
                Set(hud, "_condition", 0.72f);

                if (string.Equals(Environment.GetEnvironmentVariable(
                        "ROA_HUD_CAPTURE_CONNECTION"), "1", StringComparison.Ordinal))
                {
                    RoaSocketClient socket = host.AddComponent<RoaSocketClient>();
                    hud.Socket = socket;
                    Set(socket, "_reconnectAttempt", 3);
                    Set(socket, "_reconnectScheduled", true);
                    Set(socket, "_reconnectAt", Time.realtimeSinceStartup + 4.2f);
                }

                RoaHudCanvas canvasOwner = host.AddComponent<RoaHudCanvas>();
                canvasOwner.Configure(hud, null, null, null, null, null);
                MethodInfo update = typeof(RoaHudCanvas).GetMethod("Update",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Require(update != null, "HUD capture cannot invoke presentation update");
                update.Invoke(canvasOwner, null);

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                Require(canvas != null, "HUD capture canvas was not built");
                cameraObject = new GameObject("HudCaptureCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.16f, 0.13f, 0.085f, 1f);
                camera.nearClipPlane = 0.1f;
                camera.farClipPlane = 100f;
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32)
                {
                    name = "HudCanvasCapture",
                    antiAliasing = 4
                };
                target.Create();
                camera.targetTexture = target;
                Canvas.ForceUpdateCanvases();
                if (GraphicsSettings.currentRenderPipeline != null)
                {
                    var request = new RenderPipeline.StandardRequest { destination = target };
                    RenderPipeline.SubmitRenderRequest(camera, request);
                }
                else camera.Render();

                RenderTexture.active = target;
                readback = new Texture2D(target.width, target.height, TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0f, 0f, target.width, target.height), 0, 0);
                readback.Apply(false, false);
                File.WriteAllBytes(path, readback.EncodeToPNG());
                Debug.Log("[ROA PROBE] HUD capture: " + path);
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (target != null)
                {
                    target.Release();
                    UnityEngine.Object.DestroyImmediate(target);
                }
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Set<T>(object target, string fieldName, T value)
        {
            FieldInfo field = target.GetType().GetField(fieldName,
                BindingFlags.Instance | BindingFlags.NonPublic);
            Require(field != null, "HUD capture field missing: " + fieldName);
            field.SetValue(target, value);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
