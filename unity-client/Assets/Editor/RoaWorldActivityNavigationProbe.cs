#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

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

                host = new GameObject("WorldActivityNavigationProbe");
                RoaWorldActivityCanvas canvas = host.AddComponent<RoaWorldActivityCanvas>();
                MethodInfo ensureBuilt = typeof(RoaWorldActivityCanvas).GetMethod("EnsureBuilt", BindingFlags.Instance | BindingFlags.NonPublic);
                Require(ensureBuilt != null, "activity HUD builder is missing");
                ensureBuilt.Invoke(canvas, null);
                Transform navigation = host.transform.Find("WorldActivityCanvas/WorldActivityNavigation");
                Require(navigation != null, "activity navigation strip was not built");

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

                Debug.Log("[НАВИГАЦИЯ АКТИВНОСТИ] готово: стрелка, дистанция, мини-карта, маяк без коллайдеров");
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
