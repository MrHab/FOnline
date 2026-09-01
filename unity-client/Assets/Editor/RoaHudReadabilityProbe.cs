#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaHudReadabilityProbe
    {
        private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

        public static void Run()
        {
            Require(RoaWorldActivityCanvas.ActivityHudSize(
                    RoaWorldActivityCanvas.ActivityHudDensity.Glance) == new Vector2(330f, 100f),
                "glance card size changed");
            Require(RoaWorldActivityCanvas.ActivityHudSize(
                    RoaWorldActivityCanvas.ActivityHudDensity.Context) == new Vector2(330f, 144f),
                "context card size changed");
            Require(RoaWorldActivityCanvas.ActivityHudSize(
                    RoaWorldActivityCanvas.ActivityHudDensity.Detailed) == new Vector2(330f, 210f),
                "detailed card size changed");
            Require(RoaWorldActivityCanvas.ResolveActivityFlowStage(null)
                        == RoaWorldActivityCanvas.ActivityFlowStage.Arrival
                    && RoaWorldActivityCanvas.ResolveActivityFlowStage(Activity(
                        RoaWorldActivityCanvas.ActivityHudDensity.Glance))
                        == RoaWorldActivityCanvas.ActivityFlowStage.Objective
                    && RoaWorldActivityCanvas.ResolveActivityFlowStage(new JObject
                    {
                        ["status"] = "active",
                        ["phase"] = "extraction",
                        ["extractionOpen"] = true
                    })
                        == RoaWorldActivityCanvas.ActivityFlowStage.Extraction
                    && RoaWorldActivityCanvas.ResolveActivityFlowStage(Activity(
                        RoaWorldActivityCanvas.ActivityHudDensity.Context))
                        == RoaWorldActivityCanvas.ActivityFlowStage.Reward,
                "activity flow does not expose arrival, objective, extraction and reward states");
            Require(RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false, false,
                    false, false, false) == RoaWorldActivityCanvas.ActivityHudDensity.Glance
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(true, false, false,
                        false, false, false) == RoaWorldActivityCanvas.ActivityHudDensity.Glance
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, true, false,
                        false, false, false) == RoaWorldActivityCanvas.ActivityHudDensity.Glance
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false, false,
                        false, true, false) == RoaWorldActivityCanvas.ActivityHudDensity.Context
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false, true,
                        false, false, false) == RoaWorldActivityCanvas.ActivityHudDensity.Detailed,
                "HUD density resolver is ambiguous");
            Require(RoaWorldActivityCanvas.ActivityHudPosition(false, false)
                        == new Vector2(12f, -12f)
                    && RoaWorldActivityCanvas.ActivityHudPosition(false, true)
                        == new Vector2(12f, -96f)
                    && RoaWorldActivityCanvas.ActivityHudPosition(true, false)
                        == new Vector2(76f, -12f),
                "activity HUD does not reclaim the hidden identity-card space");

            GameObject host = null;
            GameObject detailedHost = null;
            try
            {
                host = BuildCard(RoaWorldActivityCanvas.ActivityHudDensity.Glance);
                RoaWorldActivityCanvas builtCanvas = host.GetComponent<RoaWorldActivityCanvas>();
                Transform root = host.transform.Find("WorldActivityCanvas/WorldActivityHud");
                Transform details = root?.Find("Btn:ActivityDetails");
                Transform flow = root?.Find("ActivityFlow");
                Transform rows = root?.Find("ObjectiveRows");
                Transform action = root?.Find("Btn:ActivityExtract");
                Require(root != null && ((RectTransform)root).sizeDelta == new Vector2(330f, 100f),
                    "built activity HUD is not glance-first");
                Require(flow != null && flow.childCount == 4
                        && builtCanvas.FlowStage == RoaWorldActivityCanvas.ActivityFlowStage.Objective,
                    "glance card does not explain the four-step activity flow");
                Require(details != null && details.GetComponent<Button>() != null
                        && ((RectTransform)details).rect.width >= 44f
                        && ((RectTransform)details).rect.height >= 44f,
                    "details control is not touch-safe");
                Require(rows != null && ((RectTransform)rows).rect.height <= 24f,
                    "glance card shows more than the current objective");
                Require(builtCanvas.ActiveObjectiveRowCount == 1,
                    "glance card activates more than the current objective row");
                MethodInfo applyDensity = typeof(RoaWorldActivityCanvas).GetMethod(
                    "ApplyHudDensityLayout", PrivateInstance);
                Require(applyDensity != null && action != null,
                    "context layout or primary action is missing");
                applyDensity.Invoke(host.GetComponent<RoaWorldActivityCanvas>(), new object[]
                {
                    RoaWorldActivityCanvas.ActivityHudDensity.Context
                });
                Require(((RectTransform)action).rect.width >= 300f,
                    "context primary action does not use the released card width");
                foreach (Image image in root.GetComponentsInChildren<Image>(true))
                {
                    bool interactive = image.GetComponent<Button>() != null;
                    Require(image.raycastTarget == interactive,
                        image.name + " has an invalid HUD raycast state");
                }

                detailedHost = BuildCard(RoaWorldActivityCanvas.ActivityHudDensity.Detailed);
                Require(detailedHost.GetComponent<RoaWorldActivityCanvas>().ActiveObjectiveRowCount == 2,
                    "detailed card does not restore the full objective list");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (detailedHost != null) UnityEngine.Object.DestroyImmediate(detailedHost);
            }

            Debug.Log("[HUD & ACTIVITY FLOW 4.5] обзор=100, контекст=144, детали=210, "
                + "путь=вход→цель→выход→награда, цель=1/3, кнопка=44×44.");
        }

        [MenuItem("Realm of Ashes/Проверить HUD & Activity Flow 4.5")]
        private static void CaptureAndRun()
        {
            Run();
            string root = Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
            string output = Path.Combine(root, "Library", "HudActivityFlow45");
            Directory.CreateDirectory(output);
            Capture(RoaWorldActivityCanvas.ActivityHudDensity.Glance,
                Path.Combine(output, "glance.png"));
            Capture(RoaWorldActivityCanvas.ActivityHudDensity.Context,
                Path.Combine(output, "context.png"));
            Capture(RoaWorldActivityCanvas.ActivityHudDensity.Detailed,
                Path.Combine(output, "detailed.png"));
            Capture(RoaWorldActivityCanvas.ActivityHudDensity.Glance,
                Path.Combine(output, "mobile-glance.png"), true, 1280, 720);
            CaptureResult(Path.Combine(output, "reward.png"));
            Debug.Log("[HUD & ACTIVITY FLOW 4.5] снимки: " + output);
        }

        private static GameObject BuildCard(RoaWorldActivityCanvas.ActivityHudDensity density)
        {
            var host = new GameObject("HudReadabilityProbe");
            RoaWorldActivityCanvas canvas = host.AddComponent<RoaWorldActivityCanvas>();
            MethodInfo ensure = typeof(RoaWorldActivityCanvas).GetMethod("EnsureBuilt", PrivateInstance);
            MethodInfo refresh = typeof(RoaWorldActivityCanvas).GetMethod("Refresh", PrivateInstance);
            FieldInfo activity = typeof(RoaWorldActivityCanvas).GetField("_activity", PrivateInstance);
            FieldInfo expanded = typeof(RoaWorldActivityCanvas).GetField("_detailsExpanded", PrivateInstance);
            Require(ensure != null && refresh != null && activity != null && expanded != null,
                "activity HUD probe hooks are missing");
            ensure.Invoke(canvas, null);
            activity.SetValue(canvas, Activity(density));
            expanded.SetValue(canvas, density == RoaWorldActivityCanvas.ActivityHudDensity.Detailed);
            refresh.Invoke(canvas, null);
            Require(canvas.HudDensity == density,
                "requested HUD density did not become active: " + density);
            return host;
        }

        private static JObject Activity(RoaWorldActivityCanvas.ActivityHudDensity density)
        {
            bool completed = density == RoaWorldActivityCanvas.ActivityHudDensity.Context;
            int current = completed ? 8 : 3;
            return new JObject
            {
                ["id"] = "hud-readability",
                ["taskId"] = "hud-readability-task",
                ["title"] = "Вылазка за ресурсами",
                ["kind"] = "resource_collection",
                ["phase"] = completed ? "extraction" : "scavenging",
                ["status"] = completed ? "completed" : "active",
                ["endsAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 240000L,
                ["threat"] = completed ? 18 : 42,
                ["participantCount"] = 3,
                ["objectives"] = new JArray
                {
                    new JObject
                    {
                        ["id"] = "scrap",
                        ["label"] = "Собрать металлолом",
                        ["current"] = current,
                        ["target"] = 8,
                        ["bonusTarget"] = 12,
                        ["maxTarget"] = 16,
                        ["required"] = true
                    },
                    new JObject
                    {
                        ["id"] = "parts",
                        ["label"] = "Найти детали оружия",
                        ["current"] = 0,
                        ["target"] = 2,
                        ["required"] = false
                    }
                },
                ["result"] = new JObject { ["grade"] = "completed" }
            };
        }

        private static void Capture(RoaWorldActivityCanvas.ActivityHudDensity density, string path,
                                    bool mobile = false, int width = 1280, int height = 720)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = BuildCard(density);
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                Require(canvas != null, "activity HUD capture canvas was not built");
                RoaUiScale.Apply(canvas.GetComponent<CanvasScaler>(), mobile);
                if (mobile)
                {
                    RectTransform hud = host.transform.Find(
                        "WorldActivityCanvas/WorldActivityHud") as RectTransform;
                    Require(hud != null, "mobile activity HUD root is missing");
                    hud.anchoredPosition = RoaWorldActivityCanvas.ActivityHudPosition(true, false);
                }
                cameraObject = new GameObject("HudReadabilityCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.18f, 0.145f, 0.085f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;

                target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32)
                {
                    name = "HudActivityFlow45_" + density,
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

        private static void CaptureResult(string path)
        {
            GameObject host = null;
            GameObject cameraObject = null;
            RenderTexture target = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                host = new GameObject("HudRewardProbe");
                RoaWorldActivityCanvas canvasComponent = host.AddComponent<RoaWorldActivityCanvas>();
                MethodInfo ensure = typeof(RoaWorldActivityCanvas).GetMethod("EnsureBuilt", PrivateInstance);
                MethodInfo handle = typeof(RoaWorldActivityCanvas).GetMethod("HandleAuthoritativeSelf", PrivateInstance);
                Require(ensure != null && handle != null, "reward-card probe hooks are missing");
                ensure.Invoke(canvasComponent, null);
                handle.Invoke(canvasComponent, new object[] { RewardedSelf() });

                Transform canvasRoot = host.transform.Find("WorldActivityCanvas");
                Transform activity = canvasRoot?.Find("WorldActivityHud");
                Transform result = canvasRoot?.Find("WorldActivityResult");
                Require(result != null && result.Find("ResultFlow")?.childCount == 4,
                    "reward card does not keep the four-step activity flow");
                if (activity != null) activity.gameObject.SetActive(false);
                result.gameObject.SetActive(true);
                Require(canvasComponent.LastResultRewardClaimed,
                    "reward card is not driven by the authoritative paid result");

                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                cameraObject = new GameObject("HudRewardCamera");
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.enabled = false;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.18f, 0.145f, 0.085f, 1f);
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = camera;
                canvas.planeDistance = 1f;
                target = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32)
                {
                    name = "HudActivityFlow45_Reward",
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

        private static JObject RewardedSelf()
        {
            return new JObject
            {
                ["level"] = 9,
                ["xp"] = 55,
                ["xpNeeded"] = 100,
                ["inventory"] = new JArray
                {
                    new JObject { ["id"] = "silver", ["qty"] = 117 }
                },
                ["worldFactionReputation"] = new JObject { ["old_klim"] = 14 },
                ["lastWorldActivityResult"] = new JObject
                {
                    ["id"] = "hud-flow-result",
                    ["taskId"] = "hud-flow-task",
                    ["title"] = "Вылазка за ресурсами",
                    ["status"] = "completed",
                    ["grade"] = "bonus",
                    ["rewardClaimed"] = true,
                    ["reward"] = new JObject
                    {
                        ["xp"] = 25,
                        ["caps"] = 10,
                        ["reputation"] = 4,
                        ["reputationFactionId"] = "old_klim"
                    }
                }
            };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
