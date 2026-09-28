#if UNITY_EDITOR
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Keeps the runtime wrist target in step with the player's prefab edits.</summary>
    public sealed class RoaWeaponGripPoseSync : AssetPostprocessor
    {
        private const string Source = "Assets/Prefabs/Authoring/Grip_AssaultRifle_Male.prefab";
        private const string Target = "Assets/Resources/RealmOfAshes/WeaponGripPose.asset";
        private const string Marker = "RIGHT HAND IK — move and rotate";

        [MenuItem("Realm of Ashes/PolygonApocalypse/Sync authored grip to all weapons")]
        public static void Sync()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Source);
            RoaWeaponGripPose pose = AssetDatabase.LoadAssetAtPath<RoaWeaponGripPose>(Target);
            if (prefab == null || pose == null)
            {
                Debug.LogError("[ROA] Grip prefab or runtime grip pose is missing.");
                return;
            }
            Transform marker = null;
            foreach (Transform node in prefab.GetComponentsInChildren<Transform>(true))
                if (node.name == Marker) { marker = node; break; }
            if (marker == null)
            {
                Debug.LogError("[ROA] Authoring prefab has no right hand IK target.");
                return;
            }
            Vector3 position = prefab.transform.InverseTransformPoint(marker.position);
            if ((pose.StoredRightWristLocal - position).sqrMagnitude < 0.00000001f) return;
            pose.SetRightWristLocal(position);
            EditorUtility.SetDirty(pose);
            AssetDatabase.SaveAssets();
            Debug.Log("[ROA] Authored right-hand grip synced for all weapons: " + position.ToString("F4"));
        }

        private static void OnPostprocessAllAssets(string[] importedAssets,
            string[] deletedAssets, string[] movedAssets, string[] movedFromAssetPaths)
        {
            foreach (string path in importedAssets)
                if (path == Source)
                {
                    EditorApplication.delayCall += Sync;
                    break;
                }
        }
    }
}
#endif
