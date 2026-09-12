#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaCaravanDepartureCinematicProbe
    {
        private const string RequestName = "RoaCaravanDepartureCinematicProbe.request";
        private static double _nextRequestCheck;

        static RoaCaravanDepartureCinematicProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string project = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(project)) return;
            string request = Path.Combine(project, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить кат-сцену каравана")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                Require(Mathf.Approximately(RoaCaravanDepartureCinematic.Smooth01(-1f), 0f),
                    "camera easing does not clamp its start");
                Require(Mathf.Approximately(RoaCaravanDepartureCinematic.Smooth01(0.5f), 0.5f),
                    "camera easing has an unstable midpoint");
                Require(Mathf.Approximately(RoaCaravanDepartureCinematic.Smooth01(2f), 1f),
                    "camera easing does not clamp its end");
                Vector3 pathStart = new Vector3(12f, 0f, -23f);
                Vector3 pathMiddle = new Vector3(5f, 0f, -26f);
                Vector3 pathEnd = new Vector3(0f, 0f, -37f);
                Require(RoaCaravanDepartureCinematic.EvaluateTruckPath(
                        pathStart, pathMiddle, pathEnd, 0f) == pathStart
                    && RoaCaravanDepartureCinematic.EvaluateTruckPath(
                        pathStart, pathMiddle, pathEnd, 1f) == pathEnd,
                    "caravan truck route does not enter and leave at its authored endpoints");
                Require(RoaCaravanDepartureCinematic.SkipTargetSize(false).y >= 52f
                    && RoaCaravanDepartureCinematic.SkipTargetSize(true).y >= 58f,
                    "desktop/mobile skip targets are too small");
                int allies = 0, raiders = 0;
                foreach (RoaCaravanAmbushStage.Role role in RoaCaravanAmbushStage.Cast)
                    if (role.FallsAt > 0f) { if (role.Raider) raiders++; else allies++; }
                Require(allies == 3 && raiders == 3 && RoaCaravanAmbushStage.BrahminCount == 2,
                    "authored ambush cast and persistent casualties are incomplete");

                host = new GameObject("CaravanDepartureCinematicProbe");
                RoaCaravanDepartureCinematic cinematic =
                    host.AddComponent<RoaCaravanDepartureCinematic>();
                cinematic.BuildPresentationForProbe();
                Require(cinematic.PresentationReady, "cinematic presentation was not built");

                Transform root = host.transform.Find("CaravanDepartureCinematicCanvas");
                Require(root != null, "cinematic canvas is missing");
                Require(root.Find("Fade")?.GetComponent<Image>()?.raycastTarget == true,
                    "full-screen input blocker is missing");
                Require(root.Find("AmbushFlash")?.GetComponent<Image>() != null,
                    "ambush flash is missing");
                Require(root.Find("TopLetterbox/Chapter")?.GetComponent<Text>() != null
                    && root.Find("BottomLetterbox/Subtitle")?.GetComponent<Text>() != null,
                    "letterbox titles are missing");
                Button skip = root.Find("SafeArea/Skip")?.GetComponent<Button>();
                Require(skip != null && ((RectTransform)skip.transform).sizeDelta.y >= 52f,
                    "desktop/mobile skip target is missing or too small");
                Require(root.GetComponent<Canvas>()?.sortingOrder > 70,
                    "cinematic cannot cover the loading transition");
                Debug.Log("[КАТ-СЦЕНА КАРАВАНА] PASS: letterbox, input lock, skip and camera easing");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
