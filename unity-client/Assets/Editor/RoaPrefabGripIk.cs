#if UNITY_EDITOR
using System.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Editable hand IK for the assault-rifle authoring prefab.</summary>
    [InitializeOnLoad]
    public static class RoaPrefabGripIk
    {
        private const string PrefabPath = "Assets/Prefabs/Authoring/Grip_AssaultRifle_Male.prefab";
        private const string LeftTargetName = "LEFT HAND IK — move and rotate";
        private const string RightTargetName = "RIGHT HAND IK — move and rotate";
        private const string LeftPoleName = "LEFT ELBOW DIRECTION — optional";
        private const string RightPoleName = "RIGHT ELBOW DIRECTION — optional";

        private static GameObject _root;
        private static Transform _leftTarget;
        private static Transform _rightTarget;
        private static Transform _leftPole;
        private static Transform _rightPole;
        private static Transform[] _leftBones;
        private static Transform[] _rightBones;
        private static RoaIkChain _leftArm;
        private static RoaIkChain _rightArm;
        private static Vector3 _leftPosition;
        private static Vector3 _rightPosition;
        private static Vector3 _leftPolePosition;
        private static Vector3 _rightPolePosition;
        private static Quaternion _leftRotation;
        private static Quaternion _rightRotation;

        static RoaPrefabGripIk()
        {
            EditorApplication.update += Update;
            SceneView.duringSceneGui += Draw;
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Enable prefab hand IK")]
        public static void Enable()
        {
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage == null || stage.assetPath != PrefabPath)
            {
                Debug.LogError("[ROA] Open Grip_AssaultRifle_Male.prefab in Prefab Mode first.");
                return;
            }

            GameObject root = stage.prefabContentsRoot;
            Transform[] nodes = root.GetComponentsInChildren<Transform>(true);
            Transform Bone(string name) => nodes.FirstOrDefault(node => node.name == name);
            Transform leftHand = Bone("Hand_L");
            Transform rightHand = Bone("Hand_R");
            Transform leftElbow = Bone("Elbow_L");
            Transform rightElbow = Bone("Elbow_R");
            if (leftHand == null || rightHand == null || leftElbow == null || rightElbow == null)
            {
                Debug.LogError("[ROA] The authoring prefab has no editable hand skeleton.");
                return;
            }

            CreateMarker(root.transform, LeftTargetName, leftHand.position, leftHand.rotation);
            CreateMarker(root.transform, RightTargetName, rightHand.position, rightHand.rotation);
            CreateMarker(root.transform, LeftPoleName,
                leftElbow.position - root.transform.forward * 0.3f, Quaternion.identity);
            CreateMarker(root.transform, RightPoleName,
                rightElbow.position - root.transform.forward * 0.3f, Quaternion.identity);
            EditorSceneManager.MarkSceneDirty(stage.scene);
            _root = null;
            Bind(stage);
            Selection.activeGameObject = _leftTarget.gameObject;
            Tools.current = Tool.Move;
            SceneView.RepaintAll();
        }

        private static Transform CreateMarker(Transform parent, string name,
                                               Vector3 position, Quaternion rotation)
        {
            Transform existing = parent.Find(name);
            if (existing != null) return existing;
            var marker = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(marker, "Add hand IK target");
            marker.transform.SetParent(parent, true);
            marker.transform.SetPositionAndRotation(position, rotation);
            marker.transform.localScale = Vector3.one;
            return marker.transform;
        }

        private static void Bind(PrefabStage stage)
        {
            GameObject root = stage.prefabContentsRoot;
            if (_root == root && _leftTarget != null && _rightTarget != null
                && _leftArm != null && _rightArm != null) return;
            _root = root;
            Transform[] nodes = root.GetComponentsInChildren<Transform>(true);
            Transform Find(string name) => nodes.FirstOrDefault(node => node.name == name);
            _leftTarget = Find(LeftTargetName);
            _rightTarget = Find(RightTargetName);
            _leftPole = Find(LeftPoleName);
            _rightPole = Find(RightPoleName);
            _leftBones = new[] { Find("Clavicle_L"), Find("Shoulder_L"),
                Find("Elbow_L"), Find("Hand_L") };
            _rightBones = new[] { Find("Clavicle_R"), Find("Shoulder_R"),
                Find("Elbow_R"), Find("Hand_R") };
            _leftArm = new RoaIkChain(_leftBones, 24, 0.001f);
            _rightArm = new RoaIkChain(_rightBones, 24, 0.001f);
            Remember();
        }

        private static void Remember()
        {
            if (_leftTarget != null)
            {
                _leftPosition = _leftTarget.position;
                _leftRotation = _leftTarget.rotation;
            }
            if (_rightTarget != null)
            {
                _rightPosition = _rightTarget.position;
                _rightRotation = _rightTarget.rotation;
            }
            if (_leftPole != null) _leftPolePosition = _leftPole.position;
            if (_rightPole != null) _rightPolePosition = _rightPole.position;
        }

        private static void Update()
        {
            if (EditorApplication.isPlaying) return;
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage == null || stage.assetPath != PrefabPath)
            {
                _root = null;
                return;
            }
            Bind(stage);
            bool leftChanged = _leftTarget != null && (_leftTarget.position != _leftPosition
                || _leftTarget.rotation != _leftRotation
                || _leftPole != null && _leftPole.position != _leftPolePosition);
            bool rightChanged = _rightTarget != null && (_rightTarget.position != _rightPosition
                || _rightTarget.rotation != _rightRotation
                || _rightPole != null && _rightPole.position != _rightPolePosition);
            if (!leftChanged && !rightChanged) return;
            if (leftChanged) Solve(_leftArm, _leftBones, _leftTarget, _leftPole, "left");
            if (rightChanged) Solve(_rightArm, _rightBones, _rightTarget, _rightPole, "right");
            Remember();
            EditorSceneManager.MarkSceneDirty(stage.scene);
            SceneView.RepaintAll();
        }

        private static void Solve(RoaIkChain arm, Transform[] bones, Transform target,
                                  Transform pole, string side)
        {
            if (arm == null || !arm.Ready || target == null) return;
            Undo.RecordObjects(bones, "Adjust " + side + " hand IK");
            arm.Solve(target.position, target.rotation, pole != null ? pole.position : (Vector3?)null);
            foreach (Transform bone in bones)
            {
                PrefabUtility.RecordPrefabInstancePropertyModifications(bone);
                EditorUtility.SetDirty(bone);
            }
        }

        private static void Draw(SceneView sceneView)
        {
            if (EditorApplication.isPlaying) return;
            PrefabStage stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage == null || stage.assetPath != PrefabPath) return;
            Bind(stage);
            DrawTarget(_leftTarget, Color.cyan, "LEFT HAND IK");
            DrawTarget(_rightTarget, new Color(1f, 0.7f, 0.15f), "RIGHT HAND IK");
            DrawPole(_leftPole, "LEFT ELBOW");
            DrawPole(_rightPole, "RIGHT ELBOW");
        }

        private static void DrawTarget(Transform target, Color color, string label)
        {
            if (target == null) return;
            Handles.color = color;
            float size = HandleUtility.GetHandleSize(target.position) * 0.07f;
            if (Handles.Button(target.position, target.rotation, size, size, Handles.SphereHandleCap))
                Selection.activeGameObject = target.gameObject;
            Handles.Label(target.position + Vector3.up * size * 2f, label);
        }

        private static void DrawPole(Transform pole, string label)
        {
            if (pole == null) return;
            Handles.color = Color.gray;
            float size = HandleUtility.GetHandleSize(pole.position) * 0.04f;
            if (Handles.Button(pole.position, pole.rotation, size, size, Handles.CubeHandleCap))
                Selection.activeGameObject = pole.gameObject;
            Handles.Label(pole.position + Vector3.up * size * 2f, label);
        }
    }
}
#endif
