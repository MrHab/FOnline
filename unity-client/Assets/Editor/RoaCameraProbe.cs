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

                Vector2 touchStart = new Vector2(100f, 100f);
                Check(!RoaGlobalMap.TouchDragReached(touchStart, new Vector2(108f, 106f), 14f),
                    "небольшое касание ошибочно стало drag карты");
                Check(RoaGlobalMap.TouchDragReached(touchStart, new Vector2(118f, 100f), 14f),
                    "явный drag карты не достиг порога");
                Check(RoaGlobalMap.TouchTapEligible(0.25f, touchStart, new Vector2(106f, 105f), false),
                    "короткое касание не выбирает маршрут");
                Check(!RoaGlobalMap.TouchTapEligible(0.8f, touchStart, touchStart, false)
                      && !RoaGlobalMap.TouchTapEligible(0.2f, touchStart, new Vector2(120f, 100f), false)
                      && !RoaGlobalMap.TouchTapEligible(0.2f, touchStart, touchStart, true),
                    "долгое, сдвинутое или отменённое касание ошибочно выбирает маршрут");

                float pinchIn = RoaGlobalMap.PinchZoomDistance(100f, 100f, 200f, 8f, 220f);
                float pinchOut = RoaGlobalMap.PinchZoomDistance(100f, 100f, 50f, 8f, 220f);
                Check(Mathf.Approximately(pinchIn, 50f) && Mathf.Approximately(pinchOut, 200f),
                    "pinch карты меняет масштаб в неверном направлении");
                Check(Mathf.Approximately(RoaGlobalMap.PinchZoomDistance(100f, 100f, 10000f, 8f, 220f), 8f)
                      && Mathf.Approximately(RoaGlobalMap.PinchZoomDistance(100f, 100f, 1f, 8f, 220f), 220f),
                    "pinch карты вышел за границы камеры");

                Check(RoaGlobalMap.MapScreenPointCanGesture(new Vector2(420f, 250f), 840, 500, true)
                      && !RoaGlobalMap.MapScreenPointCanGesture(new Vector2(-1f, 250f), 840, 500, true),
                    "Canvas-карта неверно определяет доступную область касания");
                Check(RoaGlobalMap.MapScreenPointCanGesture(new Vector2(200f, 250f), 840, 500, false)
                      && !RoaGlobalMap.MapScreenPointCanGesture(new Vector2(640f, 250f), 840, 500, false),
                    "legacy-панель карты не блокирует касание по интерфейсу");

                Debug.Log("[КАМЕРА] готово: zoom=8–28, distance=14, map drag="
                    + movement.x.ToString("0.00") + ":" + movement.z.ToString("0.00")
                    + ", clamp=50:-60, touch=tap/drag/pinch");
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
