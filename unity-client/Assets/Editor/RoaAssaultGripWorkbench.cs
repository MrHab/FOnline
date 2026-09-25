#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Opens the real equipped character in a paused, editable Scene view.</summary>
    [InitializeOnLoad]
    public static class RoaAssaultGripWorkbench
    {
        private const string ScenePath = "Assets/Scenes/GripWorkbench_AssaultRifle.unity";
        private const string PendingKey = "ROA_AssaultGripWorkbench_Pending";
        private const string Origin = "http://127.0.0.1:3000";
        private const string RightTargetName = "RIGHT HAND — move this grip target";
        private const string LeftTargetName = "LEFT HAND — move this grip target";
        private static Transform _rightTarget;
        private static Transform _leftTarget;
        private static RoaIkChain _rightArm;
        private static RoaIkChain _leftArm;
        private static RoaApocalypseCharacterSkin _skin;
        private static Vector3 _rightLastPosition;
        private static Vector3 _leftLastPosition;
        private static Quaternion _rightLastRotation;
        private static Quaternion _leftLastRotation;

        [Serializable]
        private sealed class GripPose
        {
            public string weaponId = "assaultRifle";
            public Vector3 visualLocalPosition;
            public Vector3 visualLocalEulerAngles;
            public Vector3 rightHandLocalEulerAngles;
            public Vector3 leftHandLocalEulerAngles;
            public Vector3 rightTargetPosition;
            public Vector3 leftTargetPosition;
            public Vector3 rightTargetEulerAngles;
            public Vector3 leftTargetEulerAngles;
        }

        static RoaAssaultGripWorkbench()
        {
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
            EditorApplication.update += UpdateHandTargets;
            SceneView.duringSceneGui += DrawHandTargets;
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Open assault rifle grip workbench")]
        public static void Open()
        {
            if (EditorApplication.isPlaying)
            {
                _ = Populate();
                return;
            }
            if (SceneManager.GetActiveScene().isDirty)
            {
                Debug.LogError("[ROA] Save the current scene before opening the grip workbench.");
                return;
            }
            if (File.Exists(Path.GetFullPath(Path.Combine(Application.dataPath,
                    "Scenes/GripWorkbench_AssaultRifle.unity"))))
                EditorSceneManager.OpenScene(ScenePath);
            else
            {
                Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            SessionState.SetBool(PendingKey, true);
            EditorApplication.EnterPlaymode();
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(PendingKey, false)) return;
            SessionState.SetBool(PendingKey, false);
            _ = Populate();
        }

        private static async Task Populate()
        {
            try
            {
                GameObject previous = GameObject.Find("AssaultGripWorkbench_Runtime");
                if (previous != null) UnityEngine.Object.Destroy(previous);
                var host = new GameObject("AssaultGripWorkbench_Runtime");
                var preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show(Origin, new CharacterAppearance
                {
                    Sex = "male", HairId = "short_crop", HairColorId = "hair_08"
                }, 480, 540);
                // The character preview normally lives outside the game world.
                // Move its host so the Scene view can frame the actual model.
                host.transform.position = new Vector3(0f, 10000f, 0f);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("The character did not load.");
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                if (character == null) throw new InvalidOperationException("Character rig is missing.");
                await character.EquipWeapon(Origin, "assaultRifle");
                if (!character.WeaponReady) throw new InvalidOperationException("Assault rifle did not load.");
                character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                await Task.Delay(250);
                character.GetComponent<RoaApocalypseCharacterSkin>()?.SyncPose();
                Transform visual = FindWeaponVisual(host.transform);
                if (visual == null) throw new InvalidOperationException("Visible assault rifle is missing.");
                RoaApocalypseCharacterSkin skin =
                    character.GetComponent<RoaApocalypseCharacterSkin>();
                if (skin == null || skin.VisibleHand(false) == null || skin.VisibleHand(true) == null)
                    throw new InvalidOperationException("Visible hand bones are missing.");
                Transform targetParent = host.transform.Find("CharacterPreviewScene");
                _rightTarget = CreateHandTarget(RightTargetName, targetParent, skin.VisibleHand(false));
                _leftTarget = CreateHandTarget(LeftTargetName, targetParent, skin.VisibleHand(true));
                _rightArm = ArmChain(skin, "R");
                _leftArm = ArmChain(skin, "L");
                _skin = skin;
                foreach (SkinnedMeshRenderer renderer in skin.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                    // A paused player loop otherwise keeps the last skinned pose on screen.
                    renderer.updateWhenOffscreen = true;
                    renderer.forceMatrixRecalculationPerRender = true;
                }
                RememberTargets();
                EditorApplication.isPaused = true;
                EditorApplication.delayCall += Focus;
                Debug.Log("[ROA] Grip workbench is paused. Move the two HAND grip targets to pose the arms, "
                    + "or move the rifle's PolygonApocalypse_Visual. Then use "
                    + "PolygonApocalypse/Export assault rifle grip values. "
                    + "Do not change its scale.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ROA] Assault grip workbench: " + error);
            }
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Focus assault rifle grip")]
        public static void Focus()
        {
            Transform visual = FindWeaponVisual(null);
            if (visual == null) return;
            RestoreHandTargets();
            RoaApocalypseCharacterSkin skin = visual.GetComponentInParent<RoaApocalypseCharacterSkin>();
            Vector3 center = skin != null ? skin.transform.position + Vector3.up * 1.15f
                : visual.position;
            SceneView sceneView = SceneView.lastActiveSceneView;
            if (sceneView != null)
            {
                sceneView.in2DMode = false;
                sceneView.pivot = center;
                sceneView.rotation = Quaternion.Euler(12f, 218f, 0f);
                sceneView.size = 1.45f;
                sceneView.Focus();
                sceneView.Repaint();
            }
            Tools.current = Tool.Move;
            GameObject selection = _rightTarget != null ? _rightTarget.gameObject : visual.gameObject;
            Selection.activeGameObject = selection;
            EditorGUIUtility.PingObject(selection);
        }

        private static Transform CreateHandTarget(string name, Transform parent, Transform hand)
        {
            var marker = new GameObject(name);
            marker.transform.SetParent(parent, true);
            marker.transform.SetPositionAndRotation(hand.position, hand.rotation);
            return marker.transform;
        }

        private static RoaIkChain ArmChain(RoaApocalypseCharacterSkin skin, string side)
        {
            Transform body = skin.transform.Find(RoaApocalypseVisuals.ChildName);
            Transform[] all = body != null ? body.GetComponentsInChildren<Transform>(true)
                : Array.Empty<Transform>();
            Transform Find(string name) => all.FirstOrDefault(node => node.name == name);
            return new RoaIkChain(new[]
            {
                Find("Clavicle_" + side), Find("Shoulder_" + side),
                Find("Elbow_" + side), Find("Hand_" + side)
            }, 24, 0.001f);
        }

        private static void RestoreHandTargets()
        {
            if (_rightTarget != null && _leftTarget != null && _rightArm != null
                && _leftArm != null && _skin != null) return;
            Transform[] all = UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Include);
            _rightTarget = all.FirstOrDefault(node => node.name == RightTargetName);
            _leftTarget = all.FirstOrDefault(node => node.name == LeftTargetName);
            Transform visual = FindWeaponVisual(null);
            RoaApocalypseCharacterSkin skin = visual != null
                ? visual.GetComponentInParent<RoaApocalypseCharacterSkin>() : null;
            if (skin == null) return;
            _skin = skin;
            _rightArm = ArmChain(skin, "R");
            _leftArm = ArmChain(skin, "L");
            RememberTargets();
        }

        private static void RememberTargets()
        {
            if (_rightTarget != null)
            {
                _rightLastPosition = _rightTarget.position;
                _rightLastRotation = _rightTarget.rotation;
            }
            if (_leftTarget != null)
            {
                _leftLastPosition = _leftTarget.position;
                _leftLastRotation = _leftTarget.rotation;
            }
        }

        private static void UpdateHandTargets()
        {
            if (!EditorApplication.isPlaying || !EditorApplication.isPaused
                || SceneManager.GetActiveScene().path != ScenePath) return;
            RestoreHandTargets();
            if (_rightTarget == null || _leftTarget == null || _skin == null) return;
            bool changed = _rightTarget.position != _rightLastPosition
                || _rightTarget.rotation != _rightLastRotation
                || _leftTarget.position != _leftLastPosition
                || _leftTarget.rotation != _leftLastRotation;
            if (!changed) return;
            ApplyHandPose();
            RememberTargets();
            SceneView.RepaintAll();
        }

        private static void ApplyHandPose()
        {
            // The visual skin retargets from the gameplay skeleton. Rebuild that
            // baseline before applying both editor targets so a later repaint or
            // paused player-loop step cannot leave the hand at its old position.
            _skin.SyncPose();
            if (_rightArm != null && _rightArm.Ready)
                _rightArm.Solve(_rightTarget.position, _rightTarget.rotation);
            if (_leftArm != null && _leftArm.Ready)
                _leftArm.Solve(_leftTarget.position, _leftTarget.rotation);
        }

        private static void DrawHandTargets(SceneView sceneView)
        {
            if (!EditorApplication.isPlaying || !EditorApplication.isPaused
                || SceneManager.GetActiveScene().path != ScenePath) return;
            RestoreHandTargets();
            if (_rightTarget != null && _leftTarget != null && _skin != null)
                ApplyHandPose();
            DrawTarget(_rightTarget, Color.cyan, "RIGHT HAND");
            DrawTarget(_leftTarget, new Color(1f, 0.7f, 0.15f), "LEFT HAND");
        }

        private static void DrawTarget(Transform target, Color color, string label)
        {
            if (target == null) return;
            Handles.color = color;
            float size = HandleUtility.GetHandleSize(target.position) * 0.075f;
            if (Handles.Button(target.position, target.rotation, size, size,
                    Handles.SphereHandleCap)) Selection.activeGameObject = target.gameObject;
            Handles.Label(target.position + Vector3.up * size * 2f, label);
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Export assault rifle grip values")]
        public static void Export()
        {
            Transform visual = FindWeaponVisual(null);
            if (visual == null)
            {
                Debug.LogError("[ROA] Open the paused assault rifle grip workbench first.");
                return;
            }
            RoaApocalypseCharacterSkin skin = visual.GetComponentInParent<RoaApocalypseCharacterSkin>();
            RestoreHandTargets();
            Transform right = skin != null ? skin.VisibleHand(false) : null;
            Transform left = skin != null ? skin.VisibleHand(true) : null;
            var pose = new GripPose
            {
                visualLocalPosition = visual.localPosition,
                visualLocalEulerAngles = visual.localEulerAngles,
                rightHandLocalEulerAngles = right != null ? right.localEulerAngles : Vector3.zero,
                leftHandLocalEulerAngles = left != null ? left.localEulerAngles : Vector3.zero,
                rightTargetPosition = _rightTarget != null ? _rightTarget.position : Vector3.zero,
                leftTargetPosition = _leftTarget != null ? _leftTarget.position : Vector3.zero,
                rightTargetEulerAngles = _rightTarget != null ? _rightTarget.eulerAngles : Vector3.zero,
                leftTargetEulerAngles = _leftTarget != null ? _leftTarget.eulerAngles : Vector3.zero
            };
            string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Temp/AssaultRifleGripWorkbench.json"));
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, JsonUtility.ToJson(pose, true));
            Debug.Log("[ROA] Grip values saved: " + path);
        }

        private static Transform FindWeaponVisual(Transform root)
        {
            Transform[] nodes = root != null
                ? root.GetComponentsInChildren<Transform>(true)
                : UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Include);
            return nodes.FirstOrDefault(node => node.name == RoaApocalypseVisuals.ChildName
                && node.parent != null && node.parent.name == "Weapon:assaultRifle");
        }
    }
}
#endif
