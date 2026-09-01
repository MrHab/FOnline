#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaWorldActivityNavigationProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить навигацию активности";
        private const string RequestName = "RoaWorldActivityNavigationProbe.request";
        private static double _nextRequestCheck;

        static RoaWorldActivityNavigationProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem(MenuPath)]
        private static void Run()
        {
            GameObject host = null;
            GameObject beaconRoot = null;
            try
            {
                Require(Mathf.Abs(RoaWorldActivityCanvas.CalculateNavigationArrowAngle(Vector3.forward, Vector3.right, Vector3.forward)) < 0.01f,
                    "forward target does not keep the arrow upright");
                Require(Mathf.Abs(RoaWorldActivityCanvas.CalculateNavigationArrowAngle(Vector3.right, Vector3.right, Vector3.forward) + 90f) < 0.01f,
                    "right target does not rotate the arrow clockwise");
                Require(RoaWorldActivityCanvas.NavigationDistanceLabel("эвакуация", 12.1f, false) == "ЭВАКУАЦИЯ · 13 М",
                    "distance label does not round up safely");
                Require(RoaWorldActivityCanvas.NavigationDistanceLabel("цель", 1f, true).Contains("ДОСТУПНО"),
                    "reachable target is not announced");
                Require(RoaWorldActivityCanvas.WorldLabelText("позиция штурма", 12.1f, false)
                        == "ПОЗИЦИЯ ШТУРМА\n13 М"
                        && RoaWorldActivityCanvas.WorldLabelText("маяк", 2f, false).EndsWith("ДОСТУПНО")
                        && RoaWorldActivityCanvas.WorldLabelText("маяк", 2f, true).EndsWith("ГОТОВО"),
                    "world objective label does not distinguish distance, reach and completion");

                Rect safe = RoaWorldActivityCanvas.TopLeftSafeScreenRect(
                    new Rect(10f, 20f, 1260f, 680f), 720);
                Rect hud = RoaWorldActivityCanvas.ActivityHudScreenRect(1280, 1f);
                Rect mobileHud = RoaWorldActivityCanvas.ActivityHudScreenRect(1280, 1f, true);
                Rect combatHud = RoaWorldActivityCanvas.ActivityHudScreenRect(1280, 1f, false, true);
                Rect detailHud = RoaWorldActivityCanvas.ActivityHudScreenRect(1280, 1f,
                    false, RoaWorldActivityCanvas.ActivityHudDensity.Detailed, true);
                Rect navigationRect = RoaWorldActivityCanvas.ActivityNavigationScreenRect(1280, 1f);
                var reserved = new List<Rect> { hud };
                Require(Mathf.Approximately(safe.yMin, 20f)
                        && Mathf.Approximately(hud.xMin, 12f)
                        && Mathf.Approximately(mobileHud.xMin, 76f)
                        && Mathf.Approximately(hud.yMin, 12f)
                        && Mathf.Approximately(mobileHud.yMin, 12f)
                        && Mathf.Approximately(detailHud.yMin, 96f)
                        && hud.width <= 330f && hud.height == 100f
                        && mobileHud.height == 100f && combatHud.height == 144f
                        && combatHud.height > hud.height && navigationRect == Rect.zero,
                    "safe-area conversion or compact activity HUD reservation is invalid");
                Require(RoaWorldActivityCanvas.TryResolveWorldLabelRect(
                        new Vector2(640f, 120f), safe, reserved, 190f, 38f, out Rect firstLabel)
                        && !firstLabel.Overlaps(hud),
                    "world objective label cannot escape the activity HUD");
                reserved.Add(firstLabel);
                Require(RoaWorldActivityCanvas.TryResolveWorldLabelRect(
                        new Vector2(640f, 120f), safe, reserved, 190f, 38f, out Rect secondLabel)
                        && !secondLabel.Overlaps(firstLabel),
                    "world objective labels overlap each other");

                host = new GameObject("WorldActivityNavigationProbe");
                RoaWorldActivityCanvas canvas = host.AddComponent<RoaWorldActivityCanvas>();
                MethodInfo ensureBuilt = typeof(RoaWorldActivityCanvas).GetMethod("EnsureBuilt", BindingFlags.Instance | BindingFlags.NonPublic);
                Require(ensureBuilt != null, "activity HUD builder is missing");
                ensureBuilt.Invoke(canvas, null);
                Transform navigation = host.transform.Find("WorldActivityCanvas/WorldActivityNavigation");
                Require(navigation != null && !navigation.gameObject.activeSelf,
                    "duplicate activity navigation strip is visible by default");
                Transform worldLabels = host.transform.Find("WorldActivityCanvas/WorldObjectiveLabels");
                Require(worldLabels != null && worldLabels.childCount == 4
                        && canvas.WorldLabelPoolSize == 4,
                    "bounded world-objective label pool was not built");
                foreach (Image image in worldLabels.GetComponentsInChildren<Image>(true))
                    Require(!image.raycastTarget, "world objective label intercepts gameplay input");
                foreach (Text text in worldLabels.GetComponentsInChildren<Text>(true))
                    Require(!text.raycastTarget, "world objective text intercepts gameplay input");

                beaconRoot = new GameObject("ObjectiveProbe");
                beaconRoot.AddComponent<RoaActivityBeacon>().Configure(new Color(0.93f, 0.78f, 0.34f, 1f), false);
                Require(beaconRoot.GetComponentsInChildren<Renderer>(true).Length >= 4,
                    "objective beacon lost its disc, ring, beam or orb");
                int enabledColliders = 0;
                string enabledColliderNames = string.Empty;
                foreach (Collider collider in beaconRoot.GetComponentsInChildren<Collider>(true))
                {
                    if (collider == null || !collider.enabled) continue;
                    enabledColliders++;
                    enabledColliderNames += " " + collider.gameObject.name + ":" + collider.GetType().Name;
                }
                Require(enabledColliders == 0, "objective beacon affects gameplay collisions:" + enabledColliderNames);

                Debug.Log("[НАВИГАЦИЯ АКТИВНОСТИ] готово: стрелка, дистанция, мини-карта, "
                    + "подписи=4/без пересечений/без ввода, маяк без коллайдеров");
            }
            catch (Exception error)
            {
                Debug.LogError("[НАВИГАЦИЯ АКТИВНОСТИ] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (beaconRoot != null) UnityEngine.Object.DestroyImmediate(beaconRoot);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
