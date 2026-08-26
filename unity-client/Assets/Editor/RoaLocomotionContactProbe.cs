using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Проверяет реверс, скольжение, остановку шагов и контактную позу.</summary>
    public static class RoaLocomotionContactProbe
    {
        [MenuItem("Realm of Ashes/Проверить контактную локомоцию")]
        public static void Run()
        {
            Vector3 wallNormal = Vector3.left;
            float directPressure = RoaLocomotionPresentation.ContactPressure(
                Vector3.right * 4f, wallNormal);
            float leavingPressure = RoaLocomotionPresentation.ContactPressure(
                Vector3.left * 4f, wallNormal);
            Require(directPressure > 0.99f && leavingPressure <= 0.001f,
                "сила контакта не отличает движение в стену от движения от стены");

            Vector3 slide = RoaLocomotionPresentation.ResolveCollisionVelocity(
                new Vector3(3f, 0f, 4f), new Vector3(0.06f, 0f, 2.5f),
                true, wallNormal);
            Require(Mathf.Abs(slide.x) < 0.001f && slide.z > 2.45f,
                "визуальная скорость не выровнялась вдоль стены");

            Vector3 stopped = RoaLocomotionPresentation.ResolveCollisionVelocity(
                Vector3.right * 4f, Vector3.right * 0.04f, true, wallNormal);
            Require(stopped.sqrMagnitude < 0.0001f,
                "прямой упор оставил ложное скольжение");

            Vector3 reversed = RoaLocomotionPresentation.SmoothVisualVelocity(
                Vector3.forward * 4f, Vector3.back * 4f, 26f, 34f, 1f / 60f);
            Require(reversed.z < -3.9f,
                "реверс всё ещё проходит через старое направление или ложный ноль");

            Vector3 accelerated = RoaLocomotionPresentation.SmoothVisualVelocity(
                Vector3.zero, Vector3.forward * 4f, 26f, 34f, 1f / 60f);
            Require(accelerated.z > 0.40f && accelerated.z < 0.45f,
                "темп старта перестал сглаживаться отдельно от направления");

            var root = new GameObject("LocomotionContactPoseProbe");
            Transform pelvis = Node(root.transform, "pelvis");
            Transform spine01 = Node(pelvis, "spine_01");
            Transform spine02 = Node(spine01, "spine_02");
            Transform spine03 = Node(spine02, "spine_03");
            Transform neck = Node(spine03, "neck_01");
            Node(neck, "head");

            var pose = new RoaCharacterPose();
            pose.Bind(root.transform);
            pose.Step(false, false, "idle", 0f, 0f, 1f, 0f,
                false, false, 0.08f, 1f, 1f, 0.5f);
            pose.Apply();

            Require(pose.Ready && pose.ContactPressure > 0.9f,
                "контакт не дошёл до процедурной позы");
            Require(pose.KneeFlex > 0.03f,
                "упор не добавил компрессию ног для foot IK");
            Require(Quaternion.Angle(Quaternion.identity, spine01.localRotation) > 1f,
                "корпус не отреагировал на направление поверхности");

            Object.DestroyImmediate(root);

            Debug.Log("[КОНТАКТНАЯ ЛОКОМОЦИЯ] готово: давление="
                + directPressure.ToString("0.00") + ", slide=" + slide
                + ", reverse=" + reversed.z.ToString("0.00")
                + ", pose=" + pose.ContactPressure.ToString("0.00"));
        }

        private static Transform Node(Transform parent, string name)
        {
            var node = new GameObject(name);
            node.transform.SetParent(parent, false);
            return node.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new System.Exception("[КОНТАКТНАЯ ЛОКОМОЦИЯ] " + message);
        }

        public static void RunBatch()
        {
            Run();
        }
    }
}
