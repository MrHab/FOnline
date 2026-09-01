#if UNITY_EDITOR
using System;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaCameraPresentationProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить живую камеру";
        private const string RequestName = "RoaCameraPresentationProbe.request";
        private static double _nextRequestCheck;

        static RoaCameraPresentationProbe()
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
            GameObject target = null;
            try
            {
                Vector3 still = RoaCameraRig.CalculateMovementLookAhead(
                    new Vector3(0.2f, 0f, 0f), 1.35f, 0.35f, 4.4f);
                Require(still.sqrMagnitude < 0.000001f,
                    "camera drifts while the target is inside the movement dead zone");

                Vector3 running = RoaCameraRig.CalculateMovementLookAhead(
                    new Vector3(4.4f, 0f, 0f), 1.35f, 0.35f, 4.4f);
                Require(Vector3.Distance(running, new Vector3(1.35f, 0f, 0f)) < 0.001f,
                    "full-speed movement look-ahead has the wrong direction or distance");

                Vector3 center = RoaCameraRig.CalculateCursorLookAhead(
                    new Vector2(0.1f, 0.1f), Vector3.right, Vector3.forward, 1.65f, 0.2f);
                Require(center.sqrMagnitude < 0.000001f,
                    "cursor framing ignores the center dead zone");

                Vector3 corner = RoaCameraRig.CalculateCursorLookAhead(
                    new Vector2(1f, 1f), Vector3.right, Vector3.forward, 1.65f, 0.2f);
                Require(Mathf.Abs(corner.magnitude - 1.65f) < 0.001f
                        && corner.x > 0f && corner.z > 0f,
                    "cursor framing has the wrong camera-relative direction or bound");

                Require(!RoaCameraRig.ShouldSnapForTargetDelta(new Vector3(7.4f, 20f, 0f), 7.5f)
                        && RoaCameraRig.ShouldSnapForTargetDelta(new Vector3(7.6f, 0f, 0f), 7.5f),
                    "teleport guard must ignore height but snap on a large planar jump");

                host = new GameObject("CameraPresentationProbe");
                target = new GameObject("CameraPresentationTarget");
                target.transform.position = new Vector3(4f, 1f, -3f);
                RoaCameraRig rig = host.AddComponent<RoaCameraRig>();
                rig.Target = target.transform;
                rig.Distance = 14f;
                rig.PitchDeg = 55f;
                rig.YawDeg = 45f;
                rig.SnapToTarget();
                Require(Mathf.Abs(Vector3.Distance(host.transform.position, target.transform.position) - 14f) < 0.001f,
                    "SnapToTarget no longer preserves the authored orbit distance");
                Require(rig.CurrentFramingOffset.sqrMagnitude < 0.000001f
                        && rig.TrackedTargetSpeed < 0.001f,
                    "snap did not reset camera framing history");

                Debug.Log("[ЖИВАЯ КАМЕРА] готово: movement=1.35m, cursor=1.65m, teleport=7.5m, snap=14m");
            }
            catch (Exception error)
            {
                Debug.LogError("[ЖИВАЯ КАМЕРА] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
                if (target != null) UnityEngine.Object.DestroyImmediate(target);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
