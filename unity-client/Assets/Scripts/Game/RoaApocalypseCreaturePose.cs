using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Folds pack zombie rigs into compact crawling mutant silhouettes.</summary>
    public sealed class RoaApocalypseCreaturePose : MonoBehaviour
    {
        public void ApplyRestPose(Transform frame)
        {
            if (frame == null) return;
            Aim("Shoulder_L", "Elbow_L", frame,
                new Vector3(-0.22f, -0.65f, 0.72f));
            Aim("Shoulder_R", "Elbow_R", frame,
                new Vector3(0.22f, -0.65f, 0.72f));
            Aim("Elbow_L", "Hand_L", frame,
                new Vector3(-0.10f, -0.95f, 0.28f));
            Aim("Elbow_R", "Hand_R", frame,
                new Vector3(0.10f, -0.95f, 0.28f));
            Aim("UpperLeg_L", "LowerLeg_L", frame,
                new Vector3(-0.18f, -0.73f, -0.52f));
            Aim("UpperLeg_R", "LowerLeg_R", frame,
                new Vector3(0.18f, -0.73f, -0.52f));
            Aim("LowerLeg_L", "Ankle_L", frame,
                new Vector3(-0.08f, -0.95f, -0.27f));
            Aim("LowerLeg_R", "Ankle_R", frame,
                new Vector3(0.08f, -0.95f, -0.27f));
        }

        private void Aim(string jointName, string childName, Transform frame, Vector3 direction)
        {
            Transform joint = Find(transform, jointName);
            Transform child = Find(transform, childName);
            if (joint == null || child == null) return;
            Vector3 current = child.position - joint.position;
            Vector3 desired = frame.TransformDirection(direction.normalized);
            if (current.sqrMagnitude < 0.0001f || desired.sqrMagnitude < 0.0001f) return;
            joint.rotation = Quaternion.FromToRotation(current, desired) * joint.rotation;
        }

        private static Transform Find(Transform root, string name)
        {
            foreach (Transform node in root.GetComponentsInChildren<Transform>(true))
                if (node.name == name) return node;
            return null;
        }
    }
}
