using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCameraProbe
    {
        [MenuItem("Realm of Ashes/Проверить камеру и панорамирование карты")]
        public static void Run()
        {
            GameObject cameraObject = null;
            GameObject targetObject = null;
            try
            {
                cameraObject = new GameObject("RoaCameraProbe");
                targetObject = new GameObject("RoaCameraTargetProbe");
                targetObject.transform.position = new Vector3(3f, 1f, -2f);
                RoaCameraRig rig = cameraObject.AddComponent<RoaCameraRig>();
                rig.Target = targetObject.transform;
                rig.MinDistance = 8f;
                rig.MaxDistance = 28f;
                rig.SmoothTime = 0f;

                rig.SetDistance(1f, false);
                Check(Mathf.Approximately(rig.Distance, 8f), "минимум zoom не соблюдён");
                rig.SetDistance(100f, false);
                Check(Mathf.Approximately(rig.Distance, 28f), "максимум zoom не соблюдён");
                rig.SetDistance(14f, false);
                rig.SnapToTarget();
                Check(Mathf.Abs(Vector3.Distance(rig.transform.position, targetObject.transform.position) - 14f) < 0.001f,
                    "камера не держит заданную дистанцию");

                Vector3 right = rig.PlanarRight();
                Vector3 forward = rig.PlanarForward();
                Check(Mathf.Abs(Vector3.Dot(right, forward)) < 0.001f,
                    "горизонтальные оси камеры не ортогональны");

                Vector3 movement = RoaGlobalMap.CameraPanMovement(
                    new Vector2(100f, -50f), 100f, 720f, Vector3.right, Vector3.forward);
                Check(movement.x < 0f && movement.z < 0f,
                    "drag карты не движет anchor против движения указателя");
                Vector3 clamped = RoaGlobalMap.ClampCameraPan(
                    new Vector3(80f, 3f, -90f), 100f, 120f);
                Check(Mathf.Approximately(clamped.x, 50f)
                      && Mathf.Approximately(clamped.z, -60f)
                      && Mathf.Approximately(clamped.y, 3f),
                    "anchor карты вышел за границы или потерял высоту");

                Debug.Log("[КАМЕРА] готово: zoom=8–28, distance=14, map drag="
                    + movement.x.ToString("0.00") + ":" + movement.z.ToString("0.00")
                    + ", clamp=50:-60");
            }
            finally
            {
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (targetObject != null) UnityEngine.Object.DestroyImmediate(targetObject);
            }
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
