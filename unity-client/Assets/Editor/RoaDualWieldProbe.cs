#if UNITY_EDITOR
using System;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Проверяет математику зеркальной кисти для парных пистолетов.</summary>
    public static class RoaDualWieldProbe
    {
        [MenuItem("Realm of Ashes/Проверить парные пистолеты")]
        public static void Run()
        {
            Matrix4x4 right = Matrix4x4.TRS(
                new Vector3(0.42f, 1.08f, 0.31f),
                Quaternion.Euler(12f, 18f, -23f),
                Vector3.one);
            Matrix4x4 left = RoaOffhandWeaponView.MirrorRigid(right);
            Matrix4x4 restored = RoaOffhandWeaponView.MirrorRigid(left);

            Vector3 rightPosition = right.GetColumn(3);
            Vector3 leftPosition = left.GetColumn(3);
            Vector3 restoredPosition = restored.GetColumn(3);
            Require(Mathf.Abs(leftPosition.x + rightPosition.x) < 0.0001f,
                "левая кисть не отражена по X");
            Require(Mathf.Abs(leftPosition.y - rightPosition.y) < 0.0001f
                && Mathf.Abs(leftPosition.z - rightPosition.z) < 0.0001f,
                "зеркальная кисть потеряла высоту или вынос вперёд");
            Require(Vector3.Distance(restoredPosition, rightPosition) < 0.0001f
                && Quaternion.Angle(restored.rotation, right.rotation) < 0.01f,
                "двойное отражение не возвращает исходную позу");

            Vector3 rightForward = right.MultiplyVector(Vector3.forward).normalized;
            Vector3 leftForward = left.MultiplyVector(Vector3.forward).normalized;
            Vector3 expectedForward = new Vector3(-rightForward.x, rightForward.y, rightForward.z);
            Require(Vector3.Angle(leftForward, expectedForward) < 0.01f,
                "левый ствол не сохраняет зеркальное направление");
            Require(Mathf.Abs(left.determinant - 1f) < 0.001f,
                "зеркальная поза стала отражённым масштабом вместо вращения");

            Require(RoaOffhandWeaponView.IsSupported("pistol")
                && RoaOffhandWeaponView.IsSupported("laserPistol")
                && !RoaOffhandWeaponView.IsSupported("rifle"),
                "во вторую руку допускается неверный класс оружия");

            Debug.Log("[ПАРНЫЕ ПИСТОЛЕТЫ] готово: зеркальная кисть, направление ствола и допустимые модели");
        }

        public static void RunBatch()
        {
            Run();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
