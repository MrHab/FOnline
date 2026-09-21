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

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
