using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Copies the existing animated pose onto a PolygonApocalypse skeleton.
    /// Each mapped bone keeps a constant offset from its source bone, measured in
    /// the bind poses of both skins and aligned along the bone: the visible body
    /// follows direction and twist of every limb, neck, feet and fingers. The pelvis
    /// also carries the source's travel (bob, crouch, fall) scaled by leg length.
    /// </summary>
    [ExecuteAlways]
    [DefaultExecutionOrder(1000)]
    public sealed class RoaApocalypseCharacterSkin : MonoBehaviour
    {
        private struct BonePair
        {
            public Transform Source;
            public Transform Target;
            public Quaternion TargetRest;
            public Quaternion SourceRest;
            public Transform SourceChild;
            public Transform TargetChild;
            /// <summary>Target rotation = source rotation * Offset (both in character space).</summary>
            public Quaternion Offset;
            public bool Pelvis;
            public Vector3 SourceRestPosition;
            public Vector3 TargetRestPosition;
        }

        private float _legScale = 1f;

        /// <summary>Diagnostics for probes: whether the last pose held a weapon and how far the right hand missed.</summary>
        public bool Armed { get; private set; }
        public float HandReachError { get; private set; } = -1f;
        /// <summary>Промах видимой кисти мимо точки хвата на модели, м (−1 — точки нет).</summary>
        public float HoldMissPrimary { get; private set; } = -1f;
        public float HoldMissSupport { get; private set; } = -1f;
        /// <summary>Класс удержания предмета в руках (для проб и обзора).</summary>
        public string HoldArchetype { get; private set; } = string.Empty;
        public bool ArmsReady => _rightArm != null && _rightArm.Ready && _leftArm != null && _leftArm.Ready;

        private readonly List<BonePair> _bones = new List<BonePair>();
        private RoaIkChain _leftArm;
        private RoaIkChain _rightArm;
        private RoaHandGrip _leftGrip;
        private RoaHandGrip _rightGrip;
        private Transform _visibleHead;
        private Transform _visibleNeck;
        private RoaIkChain _leftLeg;
        private RoaIkChain _rightLeg;
        private Transform _leftBall;
        private Transform _rightBall;
        // Rest heights above the floor (character space) of the visible ankle and ball.
        private float _ankleRestHeight = -1f;
        private float _ballRestHeight = -1f;
        private Transform _sourceLeftHand;
        private Transform _sourceRightHand;
        private Transform _visibleLeftHand;
        private Transform _visibleRightHand;
        private GameObject _visual;
        private Transform _rigRoot;
        private Vector3 _visualRestLocalPosition;
        private GameObject _basePrefab;
        private GameObject _activePrefab;
        private SkinnedMeshRenderer _bodyRenderer;
        private Mesh _originalBodyMesh;
        private GameObject _armorRoot;
        private string _armorId;
        private readonly List<GameObject> _armorParts = new List<GameObject>();
        private bool _female;
        private RoaCharacterView _view;
        private GameObject _backpack;
        private GameObject _helmet;
        private GameObject _helmetPrefab;
        private readonly List<GameObject> _nativeHair = new List<GameObject>();
        private readonly List<GameObject> _footwear = new List<GameObject>();
        private GameObject _footwearRoot;
        private string _footwearId;

        public GameObject ActivePrefab => _activePrefab;
        public string ActiveArmorId => _armorId;
        public int ActiveArmorParts => _armorParts.Count;
        public GameObject ActiveHelmetPrefab => _helmetPrefab;
        public bool AnyNativeHairVisible
        {
            get
            {
                foreach (GameObject hair in _nativeHair)
                    if (hair != null && hair.activeSelf) return true;
                return false;
            }
        }
        public int NativeHairCount => _nativeHair.Count;
        public string ActiveFootwearId => _footwearId;
        public int ActiveFootwearParts => _footwear.Count;

        private static readonly string[] ArmorIds =
        {
            "leather", "metalArmor", "ballisticVest", "combatArmor",
            "heavyArmor", "hazmatSuit", "energySuit"
        };

        private static readonly string[] HelmetIds =
        {
            "weldedHelmet", "helmet", "tacticalHelmet", "assaultHelmet", "preWarHelmet"
        };

        private static readonly string[] FootwearIds =
        {
            "boots", "scoutBoots", "reinforcedBoots", "assaultBoots"
        };

        public bool Bind(GameObject prefab)
        {
            Transform rig = null;
            foreach (Transform child in GetComponentsInChildren<Transform>(true))
                if (child.name == "npc_humanoid_root" || child.name == "character_root")
                { rig = child; break; }
            return Bind(prefab, rig);
        }

        public bool Bind(GameObject prefab, Transform rigRoot)
        {
            if (prefab == null || rigRoot == null || _visual != null) return false;
            if (_basePrefab == null)
            {
                _basePrefab = prefab;
                _female = prefab.name.Contains("_Female_");
                _view = GetComponent<RoaCharacterView>();
            }
            _activePrefab = prefab;
            _rigRoot = rigRoot;
            var source = new Dictionary<string, Transform>();
            var originalRenderers = new List<Renderer>();
            var sourceRenderers = new List<Renderer>();
            Renderer bodyRenderer = null;
            foreach (Transform bone in rigRoot.GetComponentsInChildren<Transform>(true))
            {
                string key = RetargetKey(bone, false);
                if (!source.ContainsKey(key)) source.Add(key, bone);
            }
            foreach (Renderer renderer in rigRoot.GetComponentsInChildren<Renderer>(true))
            {
                if (!(renderer is MeshRenderer || renderer is SkinnedMeshRenderer)
                    || IsHeldItem(renderer.transform)) continue;
                sourceRenderers.Add(renderer);
                if (renderer.name == "body_base") bodyRenderer = renderer;
                if (renderer.enabled) originalRenderers.Add(renderer);
            }

            // Align the permanent pack body to the existing gameplay rig.
            Bounds oldBounds = bodyRenderer != null
                ? bodyRenderer.bounds : WorldBounds(sourceRenderers);

            _nativeHair.Clear();
            _visual = Instantiate(prefab, transform, false);
            _visual.name = RoaApocalypseVisuals.ChildName;
            RoaApocalypseVisuals.SetNativeWorldScale(_visual.transform, prefab.transform.localScale);
            foreach (SkinnedMeshRenderer renderer in _visual.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (renderer.name == prefab.name)
                {
                    _bodyRenderer = renderer;
                    _originalBodyMesh = renderer.sharedMesh;
                    break;
                }
            foreach (Animator animator in _visual.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Collider collider in _visual.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            foreach (Renderer renderer in _visual.GetComponentsInChildren<Renderer>(true))
            {
                string name = renderer.name;
                // A character can load while its owner is hidden or prewarmed.
                // Keep authored hair even when the outer actor is inactive.
                if (name.Contains("_Hair_") && renderer.enabled && renderer.gameObject.activeSelf)
                    _nativeHair.Add(renderer.gameObject);
                if (name.Contains("Backpack") || name.Contains("Bedroll")
                    || name.Contains("SupplyBag") || name.Contains("Helmet")
                    || name.Contains("_Hat_") || name.Contains("_Mask_"))
                    renderer.enabled = false;
            }
            foreach (Transform child in _visual.GetComponentsInChildren<Transform>(true))
                child.gameObject.layer = gameObject.layer;
            foreach (Transform target in _visual.GetComponentsInChildren<Transform>(true))
            {
                if (!source.TryGetValue(RetargetKey(target, true), out Transform old)) continue;
                _bones.Add(new BonePair
                {
                    Source = old,
                    Target = target,
                    TargetRest = target.localRotation,
                    SourceRest = old.localRotation
                });
            }
            for (int i = 0; i < _bones.Count; i++)
            {
                BonePair parent = _bones[i];
                int bestDepth = int.MaxValue;
                foreach (BonePair candidate in _bones)
                {
                    if (candidate.Source == parent.Source || candidate.Target == parent.Target
                        || !candidate.Source.IsChildOf(parent.Source)
                        || !candidate.Target.IsChildOf(parent.Target)) continue;
                    // Along the body: the spine over a leg, the neck over a
                    // clavicle, the middle finger over the others.
                    string childKey = RetargetKey(candidate.Target, true);
                    bool axial = childKey.StartsWith("spine") || childKey.StartsWith("neck")
                        || childKey.StartsWith("middle_01") || childKey == "head";
                    int depth = (Depth(candidate.Target) - Depth(parent.Target)) * 2 + (axial ? 0 : 1);
                    if (depth >= bestDepth) continue;
                    bestDepth = depth;
                    parent.SourceChild = candidate.Source;
                    parent.TargetChild = candidate.Target;
                }
                _bones[i] = parent;
            }
            _bones.Sort((a, b) => Depth(a.Target).CompareTo(Depth(b.Target)));
            _sourceLeftHand = source.TryGetValue("hand_l", out Transform sourceLeft) ? sourceLeft : null;
            _sourceRightHand = source.TryGetValue("hand_r", out Transform sourceRight) ? sourceRight : null;
            _visibleLeftHand = FindVisualBone("Hand_L");
            _visibleRightHand = FindVisualBone("Hand_R");
            _leftArm = VisualArm("L");
            _leftLeg = VisualLeg("L");
            _rightLeg = VisualLeg("R");
            _leftBall = FindVisualBone("Ball_L");
            _rightBall = FindVisualBone("Ball_R");
            _rightArm = VisualArm("R");
            if (_bones.Count >= 10)
            {
                var fresh = new List<Renderer>();
                foreach (Renderer renderer in _visual.GetComponentsInChildren<Renderer>(true))
                    if (renderer.enabled && renderer.gameObject.activeInHierarchy) fresh.Add(renderer);
                var newBounds = WorldBounds(fresh);
                if (newBounds.size.y > 0.01f && oldBounds.size.y > 0.01f)
                {
                    Vector3 offset = new Vector3(oldBounds.center.x - newBounds.center.x,
                        oldBounds.min.y - newBounds.min.y, oldBounds.center.z - newBounds.center.z);
                    _visual.transform.position += offset;
                }
                _visualRestLocalPosition = _visual.transform.localPosition;
                ComputeOffsets(bodyRenderer as SkinnedMeshRenderer);
                Dictionary<Transform, Matrix4x4> handRest = RestPose(_bodyRenderer);
                _rightGrip = VisualGrip(_visibleRightHand, false, handRest);
                _leftGrip = VisualGrip(_visibleLeftHand, true, handRest);
                _visibleHead = FindVisualBone("Head");
                _visibleNeck = FindVisualBone("Neck");
                foreach (Renderer renderer in originalRenderers) renderer.enabled = false;
                RefreshNativeHair();
                return true;
            }
            foreach (Renderer renderer in originalRenderers) renderer.enabled = true;
            Destroy(_visual);
            _visual = null;
            _bones.Clear();
            return false;
        }

        public void HideLegacyVisuals()
        {
            if (_visual == null || _rigRoot == null) return;
            foreach (Renderer renderer in _rigRoot.GetComponentsInChildren<Renderer>(true))
                if (HidesOriginalRenderer(renderer) && renderer.enabled)
                    renderer.enabled = false;
        }

        // The visibility gate must not revive the hidden source body or armor.
        public bool HidesOriginalRenderer(Renderer renderer)
        {
            return _visual != null && _rigRoot != null && renderer != null
                && renderer.transform.IsChildOf(_rigRoot)
                && !IsHeldItem(renderer.transform);
        }

        private static bool IsHeldItem(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
                if (item.name.StartsWith("Weapon:") || item.name.StartsWith("OffhandWeapon:")
                    || item.name.StartsWith("ItemModel:")
                    || item.name.StartsWith("Vehicle:") || item.name.StartsWith("CreatureWeapon:"))
                    return true;
            return false;
        }

        public Transform VisibleHand(bool left) => left ? _visibleLeftHand : _visibleRightHand;

        private Transform FindVisualBone(string name)
        {
            if (_visual == null) return null;
            foreach (Transform bone in _visual.GetComponentsInChildren<Transform>(true))
                if (bone.name == name) return bone;
            return null;
        }

        private RoaIkChain VisualArm(string side)
        {
            return new RoaIkChain(new[]
            {
                FindVisualBone("Clavicle_" + side), FindVisualBone("Shoulder_" + side),
                FindVisualBone("Elbow_" + side), FindVisualBone("Hand_" + side)
            }, 12, 0.005f);
        }

        private static Bounds WorldBounds(IEnumerable<Renderer> renderers)
        {
            Bounds result = default;
            bool any = false;
            foreach (Renderer renderer in renderers)
            {
                if (!any) { result = renderer.bounds; any = true; }
                else result.Encapsulate(renderer.bounds);
            }
            return result;
        }

        private void LateUpdate() => SyncPose();

        public void SyncPose()
        {
            if (_visual == null) return;
            // The pelvis carries the rig's travel (knee flex, crouch, fall) itself.
            _visual.transform.position = transform.TransformPoint(_visualRestLocalPosition);
            if (_basePrefab != null && Vector3.Distance(_visual.transform.lossyScale,
                    _basePrefab.transform.localScale) > 0.0001f)
                RoaApocalypseVisuals.SetNativeWorldScale(_visual.transform, _basePrefab.transform.localScale);
            RefreshArmor();
            RefreshAccessories();
            UpdateIdentityMesh();
            RefreshNativeHair();
            Quaternion character = transform.rotation;
            Quaternion toCharacter = Quaternion.Inverse(character);
            foreach (BonePair pair in _bones)
            {
                if (pair.Source == null || pair.Target == null) continue;
                pair.Target.rotation = character * (toCharacter * pair.Source.rotation * pair.Offset);
                if (pair.Pelvis)
                {
                    Vector3 travel = transform.InverseTransformPoint(pair.Source.position) - pair.SourceRestPosition;
                    pair.Target.position = transform.TransformPoint(pair.TargetRestPosition + travel * _legScale);
                }
            }
            // The rig drops its root to bend the knees (idle, walk, crouch); the
            // feet come back onto the floor here, and a toe never cuts into it.
            PlantFoot(_leftLeg, _leftBall);
            PlantFoot(_rightLeg, _rightBall);
            // Limb proportions differ: a held weapon hangs on the source hands, so
            // the visible hands reach them, keeping the retargeted wrist and elbow.
            bool armed = _view != null && (!string.IsNullOrEmpty(_view.WeaponId) || _view.OffhandWeaponReady);
            Armed = armed;
            HoldMissPrimary = -1f;
            HoldMissSupport = -1f;
            HoldArchetype = string.Empty;
            if (!armed) return;
            RoaWeaponView weapon = _view.HeldWeapon;
            if (weapon != null && weapon.HoldActive && (weapon.HoldRight.Active || weapon.HoldLeft.Active))
            {
                // Кисти — на места рук самой модели, пальцы обхватывают рукоять;
                // свободная рука остаётся за клипом.
                HoldArchetype = weapon.HoldKind;
                HoldMissPrimary = Hold(_rightArm, _rightGrip, weapon.HoldRight, false);
                RoaHandTarget left = weapon.HoldLeft;
                RoaOffhandWeaponView offhand = _view.HeldOffhand;
                if (!left.Active && offhand != null && offhand.HoldLeft.Active) left = offhand.HoldLeft;
                HoldMissSupport = Hold(_leftArm, _leftGrip, left, true);
                TiltHead(weapon.HoldHeadPitch, weapon.HoldHeadRoll);
                HandReachError = HoldMissPrimary;
                return;
            }
            if (_view.WeaponId == "medkit" && _rightGrip != null)
            {
                // Кейс висит в кулаке за ручку: ручка поперёк ладони, корпус отвесно вниз.
                _rightGrip.ApplyFingers(RoaFingerPose.Wrap, 0.012f);
                Transform medical = weapon != null ? weapon.MedicalCase : null;
                Transform handle = weapon != null ? weapon.MedicalHandle : null;
                if (medical != null && handle != null)
                {
                    _rightGrip.HeldFrame(0.0f, out Vector3 centre, out Vector3 axis, out _);
                    Vector3 across = Vector3.ProjectOnPlane(axis, Vector3.up);
                    if (across.sqrMagnitude < 1e-4f) across = transform.forward;
                    CaseAxes(medical, handle, out Vector3 upLocal, out Vector3 widthLocal);
                    // Ось «вверх» кейса (к ручке) — отвесно, ширина кейса — вдоль ручки в ладони.
                    Quaternion want = Quaternion.LookRotation(Vector3.Cross(across.normalized, Vector3.up), Vector3.up);
                    Quaternion have = Quaternion.LookRotation(Vector3.Cross(widthLocal, upLocal), upLocal);
                    medical.rotation = want * Quaternion.Inverse(have);
                    medical.position += centre - medical.TransformPoint(_caseGrip);
                }
                return;
            }
            ReachHand(_rightArm, _sourceRightHand, _visibleRightHand);
            ReachHand(_leftArm, _sourceLeftHand, _visibleLeftHand);
            HandReachError = _sourceRightHand != null && _visibleRightHand != null
                ? Vector3.Distance(_sourceRightHand.position, _visibleRightHand.position) : -1f;
        }

        private Transform _caseRoot;
        private Vector3 _caseUp = Vector3.up;
        private Vector3 _caseWidth = Vector3.right;
        private Vector3 _caseGrip;

        /// <summary>
        /// Оси кейса в его собственной системе: «вверх» — от центра к ручке, ширина —
        /// самая длинная из двух других осей. Импорт модели может повернуть корень,
        /// поэтому оси снимаются с геометрии.
        /// </summary>
        private void CaseAxes(Transform root, Transform handle, out Vector3 up, out Vector3 width)
        {
            if (_caseRoot != root)
            {
                _caseRoot = root;
                // Оси сняты с модели кейса аптечки (item_medkit): ручка на торце самой
                // длинной оси, со стороны −ось; ширина — бо́льшая из двух других осей.
                var bounds = new Bounds();
                bool any = false;
                foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (filter.sharedMesh == null) continue;
                    Bounds b = filter.sharedMesh.bounds;
                    Matrix4x4 toRoot = root.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                    for (int i = 0; i < 8; i++)
                    {
                        Vector3 corner = toRoot.MultiplyPoint3x4(b.center + Vector3.Scale(b.extents,
                            new Vector3((i & 1) == 0 ? -1f : 1f, (i & 2) == 0 ? -1f : 1f, (i & 4) == 0 ? -1f : 1f)));
                        if (!any) { bounds = new Bounds(corner, Vector3.zero); any = true; }
                        else bounds.Encapsulate(corner);
                    }
                }
                Vector3 size = bounds.size;
                int upAxis = size.x >= size.y && size.x >= size.z ? 0 : (size.y >= size.z ? 1 : 2);
                int a = (upAxis + 1) % 3, c = (upAxis + 2) % 3;
                _caseUp = Vector3.zero;
                _caseUp[upAxis] = -1f;
                _caseWidth = Vector3.zero;
                _caseWidth[size[a] >= size[c] ? a : c] = 1f;
                // Хват — середина торца с ручкой.
                _caseGrip = bounds.center + _caseUp * (size[upAxis] * 0.5f);
            }
            up = _caseUp;
            width = _caseWidth;
        }

        private RoaIkChain VisualLeg(string side)
        {
            return new RoaIkChain(new[]
            {
                FindVisualBone("UpperLeg_" + side), FindVisualBone("LowerLeg_" + side), FindVisualBone("Ankle_" + side)
            }, 12, 0.003f);
        }

        private void PlantFoot(RoaIkChain leg, Transform ball)
        {
            if (leg == null || !leg.Ready || _ankleRestHeight < 0f) return;
            Transform ankle = leg.End;
            Transform knee = ankle.parent;
            float floor = transform.position.y;
            float lowest = floor + _ankleRestHeight;
            if (ankle.position.y < lowest - 0.002f)
            {
                Quaternion footRotation = ankle.rotation;
                Vector3 target = new Vector3(ankle.position.x, lowest, ankle.position.z);
                // The knee bends forward, over the toes.
                Vector3 pole = knee.position + transform.forward * 0.5f;
                leg.Solve(target, footRotation, pole);
            }
            if (ball == null || _ballRestHeight < 0f) return;
            float ballFloor = floor + _ballRestHeight * 0.6f;
            Vector3 toe = ball.position - ankle.position;
            if (ball.position.y >= ballFloor || toe.sqrMagnitude < 1e-4f) return;
            Vector3 axis = Vector3.Cross(toe, Vector3.up);
            if (axis.sqrMagnitude < 1e-6f) return;
            float lift = Mathf.Asin(Mathf.Clamp((ballFloor - ball.position.y) / toe.magnitude, 0f, 1f)) * Mathf.Rad2Deg;
            ankle.rotation = Quaternion.AngleAxis(lift, axis.normalized) * ankle.rotation;
        }

        /// <summary>Положить видимую кисть на рукоять; вернуть промах ладони, м (−1 — цели нет).</summary>
        private float Hold(RoaIkChain arm, RoaHandGrip grip, RoaHandTarget target, bool left)
        {
            if (!target.Active || arm == null || !arm.Ready || grip == null || !grip.Ready) return -1f;
            Quaternion rotation = grip.RotationFor(target.Axis, target.Back);
            Vector3 wrist = grip.WristFor(target, rotation);
            Transform elbow = grip.Hand.parent;
            Transform shoulder = elbow != null ? elbow.parent : null;
            // Локти вниз, а не в стороны: правый — вниз и чуть наружу, левый — под цевьё.
            Vector3 bend = transform.right * (left ? 0.15f : 0.32f) + Vector3.down - transform.forward * 0.12f;
            if (shoulder == null || !TwoBone(shoulder, elbow, grip.Hand, wrist, rotation, bend))
                arm.Solve(wrist, rotation, (shoulder != null ? shoulder.position : transform.position) + bend);
            grip.ApplyFingers(target.Fingers, target.Radius);
            return Vector3.Distance(grip.PalmCentre(target.Radius), target.Centre);
        }

        /// <summary>
        /// Аналитический IK плеча и локтя: локоть лежит в плоскости, заданной
        /// направлением bend, — локти не «разводятся крыльями», как у итеративного
        /// решателя. Недостижимую цель рука берёт выпрямленной.
        /// </summary>
        private static bool TwoBone(Transform shoulder, Transform elbow, Transform hand, Vector3 target,
            Quaternion handRotation, Vector3 bend)
        {
            Vector3 s = shoulder.position;
            float upper = Vector3.Distance(s, elbow.position);
            float lower = Vector3.Distance(elbow.position, hand.position);
            if (upper < 1e-4f || lower < 1e-4f) return false;
            Vector3 toTarget = target - s;
            float distance = Mathf.Clamp(toTarget.magnitude, Mathf.Abs(upper - lower) + 1e-3f, upper + lower - 1e-4f);
            Vector3 direction = toTarget.normalized;
            float along = (upper * upper + distance * distance - lower * lower) / (2f * distance);
            float height = Mathf.Sqrt(Mathf.Max(0f, upper * upper - along * along));
            Vector3 side = Vector3.ProjectOnPlane(bend, direction);
            if (side.sqrMagnitude < 1e-6f) side = Vector3.ProjectOnPlane(Vector3.down, direction);
            if (side.sqrMagnitude < 1e-6f) side = Vector3.ProjectOnPlane(Vector3.forward, direction);
            Vector3 elbowTarget = s + direction * along + side.normalized * height;
            shoulder.rotation = Quaternion.FromToRotation(elbow.position - s, elbowTarget - s) * shoulder.rotation;
            Vector3 reach = s + direction * distance;
            elbow.rotation = Quaternion.FromToRotation(hand.position - elbow.position, reach - elbow.position) * elbow.rotation;
            hand.rotation = handRotation;
            return true;
        }

        /// <summary>Голова к прицелу: наклон вниз к прикладу и к плечу. Поровну на шею и голову.</summary>
        private void TiltHead(float pitch, float roll)
        {
            if (Mathf.Abs(pitch) < 0.01f && Mathf.Abs(roll) < 0.01f) return;
            Quaternion tilt = Quaternion.AngleAxis(pitch * 0.5f, transform.right)
                * Quaternion.AngleAxis(roll * 0.5f, -transform.forward);
            if (_visibleNeck != null) _visibleNeck.rotation = tilt * _visibleNeck.rotation;
            if (_visibleHead != null) _visibleHead.rotation = tilt * _visibleHead.rotation;
        }

        private RoaHandGrip VisualGrip(Transform hand, bool left, Dictionary<Transform, Matrix4x4> bind)
        {
            if (hand == null) return null;
            Transform Child(string name)
            {
                foreach (Transform node in hand.GetComponentsInChildren<Transform>(true))
                    // У правой кисти пака имена с суффиксом: «Thumb_01 1».
                    if (node != hand && (node.name == name || node.name.StartsWith(name + " "))) return node;
                return null;
            }
            Transform[] Chain(string name) => new[] { Child(name + "_01"), Child(name + "_02"), Child(name + "_03") };
            var grip = new RoaHandGrip(hand, left, bind, Chain("IndexFinger"), Chain("Finger"), Chain("Thumb"));
            return grip.Ready ? grip : null;
        }

        private static void ReachHand(RoaIkChain arm, Transform sourceHand, Transform visibleHand)
        {
            if (arm == null || !arm.Ready || sourceHand == null || visibleHand == null) return;
            Transform elbow = visibleHand.parent;
            Quaternion wrist = visibleHand.rotation;
            arm.Solve(sourceHand.position, wrist, elbow != null ? elbow.position + (elbow.position - visibleHand.position) * 0.25f : (Vector3?)null);
        }

        /// <summary>
        /// Bind-pose offsets: rests of both skeletons come from their skins (so the
        /// pose the rig happens to hold at load time does not leak in), each target
        /// rest is turned to lie along its source bone, and the difference is kept.
        /// </summary>
        private void ComputeOffsets(SkinnedMeshRenderer sourceSkin)
        {
            Dictionary<Transform, Matrix4x4> sourceRest = RestPose(sourceSkin);
            Dictionary<Transform, Matrix4x4> targetRest = RestPose(_bodyRenderer);
            Matrix4x4 toCharacter = transform.worldToLocalMatrix;
            Matrix4x4 Rest(Dictionary<Transform, Matrix4x4> rest, Transform bone) =>
                toCharacter * (rest.TryGetValue(bone, out Matrix4x4 world) ? world : bone.localToWorldMatrix);
            var align = new Dictionary<Transform, Quaternion>();
            for (int i = 0; i < _bones.Count; i++)
            {
                BonePair pair = _bones[i];
                Matrix4x4 source = Rest(sourceRest, pair.Source);
                Matrix4x4 target = Rest(targetRest, pair.Target);
                Quaternion turn = Quaternion.identity;
                if (pair.SourceChild != null && pair.TargetChild != null)
                {
                    Vector3 sourceDir = Rest(sourceRest, pair.SourceChild).GetPosition() - source.GetPosition();
                    Vector3 targetDir = Rest(targetRest, pair.TargetChild).GetPosition() - target.GetPosition();
                    if (sourceDir.sqrMagnitude > 1e-6f && targetDir.sqrMagnitude > 1e-6f)
                        turn = Quaternion.FromToRotation(targetDir, sourceDir);
                }
                else
                {
                    // An end bone (hand, head, toe) keeps its parent's alignment.
                    for (Transform up = pair.Target.parent; up != null; up = up.parent)
                        if (align.TryGetValue(up, out Quaternion inherited)) { turn = inherited; break; }
                }
                align[pair.Target] = turn;
                pair.Offset = Quaternion.Inverse(source.rotation) * turn * target.rotation;
                pair.Pelvis = RetargetKey(pair.Target, true) == "pelvis";
                pair.SourceRestPosition = source.GetPosition();
                pair.TargetRestPosition = target.GetPosition();
                string key = RetargetKey(pair.Target, true);
                if (key == "foot_l" || key == "foot_r")
                    _ankleRestHeight = Mathf.Max(0.02f, pair.TargetRestPosition.y);
                if (key == "ball_l" || key == "ball_r")
                    _ballRestHeight = Mathf.Max(0.005f, pair.TargetRestPosition.y);
                if (pair.Pelvis && pair.SourceRestPosition.y > 0.2f)
                    _legScale = Mathf.Clamp(pair.TargetRestPosition.y / pair.SourceRestPosition.y, 0.6f, 1.6f);
                _bones[i] = pair;
            }
        }

        private static Dictionary<Transform, Matrix4x4> RestPose(SkinnedMeshRenderer skin)
        {
            var rest = new Dictionary<Transform, Matrix4x4>();
            if (skin == null || skin.sharedMesh == null) return rest;
            Transform[] bones = skin.bones;
            Matrix4x4[] bindposes = skin.sharedMesh.bindposes;
            for (int i = 0; i < bones.Length && i < bindposes.Length; i++)
                if (bones[i] != null && !rest.ContainsKey(bones[i]))
                    rest[bones[i]] = skin.transform.localToWorldMatrix * bindposes[i].inverse;
            return rest;
        }

        /// <summary>
        /// One name per joint for both skeletons, in the old rig's words: Synty's
        /// Hips/Shoulder/Elbow/UpperLeg/Ankle/Toes and side-less finger chains
        /// (IndexFinger, Finger = middle, Thumb under Hand_L or Hand_R).
        /// </summary>
        private static string RetargetKey(Transform bone, bool pack)
        {
            string name = (bone != null ? bone.name : string.Empty).ToLowerInvariant();
            if (!pack) return name;
            string side = name.EndsWith("_l") ? "l" : name.EndsWith("_r") ? "r" : string.Empty;
            string stem = side.Length > 0 ? name.Substring(0, name.Length - 2) : name;
            switch (stem)
            {
                case "hips": return "pelvis";
                case "neck": return "neck_01";
                case "shoulder": return "upperarm_" + side;
                case "elbow": return "lowerarm_" + side;
                case "upperleg": return "thigh_" + side;
                case "lowerleg": return "calf_" + side;
                case "ankle": return "foot_" + side;
                case "toes": return "ball_leaf_" + side;
            }
            string finger = stem.StartsWith("indexfinger_") ? "index" : stem.StartsWith("finger_") ? "middle"
                : stem.StartsWith("thumb_") ? "thumb" : string.Empty;
            if (finger.Length == 0) return name;
            string hand = string.Empty;
            for (Transform up = bone.parent; up != null && hand.Length == 0; up = up.parent)
                hand = up.name == "Hand_L" ? "l" : up.name == "Hand_R" ? "r" : string.Empty;
            if (hand.Length == 0) return name;
            string index = stem.Substring(stem.LastIndexOf('_') + 1);
            return finger + "_" + index + (index == "04" ? "_leaf_" : "_") + hand;
        }

        private void RefreshArmor()
        {
            if (_view == null || _bodyRenderer == null) return;
            string itemId = LoadedItem("armor", ArmorIds);
            if (itemId == _armorId) return;
            if (_armorRoot != null)
            {
                _armorRoot.SetActive(false);
                if (Application.isPlaying) Destroy(_armorRoot);
                else DestroyImmediate(_armorRoot);
                _armorRoot = null;
            }
            foreach (GameObject part in _armorParts)
            {
                if (part == null) continue;
                part.SetActive(false);
                if (Application.isPlaying) Destroy(part);
                else DestroyImmediate(part);
            }
            _armorParts.Clear();
            _bodyRenderer.sharedMesh = _originalBodyMesh;
            _armorId = null;
            if (string.IsNullOrEmpty(itemId)) return;

            string body = _female ? "female_medium" : "male_medium";
            Mesh faceAndHands = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/base_" + body);
            Mesh garment = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/" + itemId + "_" + body);
            GameObject donor = RoaApocalypseModels.CharacterOutfit(_female, itemId);
            if (faceAndHands == null || garment == null || donor == null) return;
            SkinnedMeshRenderer source = null;
            foreach (SkinnedMeshRenderer renderer in donor.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (renderer.name == donor.name) { source = renderer; break; }
            if (source == null) return;

            var targetBones = new Dictionary<string, Transform>();
            foreach (Transform node in _visual.GetComponentsInChildren<Transform>(true))
                if (!targetBones.ContainsKey(node.name)) targetBones.Add(node.name, node);
            Transform[] bones = new Transform[source.bones.Length];
            for (int i = 0; i < bones.Length; i++)
                if (source.bones[i] == null || !targetBones.TryGetValue(source.bones[i].name, out bones[i]))
                    return;

            _armorRoot = new GameObject("PolygonApocalypse_Armor:" + itemId);
            _armorRoot.transform.SetParent(_visual.transform, false);
            _armorRoot.layer = gameObject.layer;
            var layer = _armorRoot.AddComponent<SkinnedMeshRenderer>();
            layer.sharedMesh = garment;
            layer.sharedMaterials = source.sharedMaterials;
            layer.bones = bones;
            if (source.rootBone != null && targetBones.TryGetValue(source.rootBone.name, out Transform rootBone))
                layer.rootBone = rootBone;
            layer.localBounds = garment.bounds;
            layer.updateWhenOffscreen = true;
            layer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            layer.receiveShadows = false;
            foreach (MeshRenderer part in donor.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (!part.enabled || !part.gameObject.activeSelf || !part.name.Contains("Armour")) continue;
                if (itemId == "heavyArmor" && part.name.Contains("Sports")) continue;
                AttachArmorPart(part.gameObject, part.transform.parent?.name, targetBones);
            }
            if (itemId == "heavyArmor")
            {
                // Both body variants use the pack's native metal plates; the
                // female donor outfits have no metal shoulder pieces.
                AddDonorPart(RoaApocalypseModels.CharacterOutfit(false, "metalArmor"),
                    "Armour_Shoulder_Metal_L", targetBones);
                AddDonorPart(RoaApocalypseModels.CharacterOutfit(false, "combatArmor"),
                    "Armour_Shoulder_Metal_R", targetBones);
                RoaApocalypseModels.FootwearEntry plates = RoaApocalypseModels.Footwear("assaultBoots");
                if (plates != null)
                {
                    AttachArmorPart(plates.leftKnee, "LowerLeg_L", targetBones);
                    AttachArmorPart(plates.rightKnee, "LowerLeg_R", targetBones);
                    AttachArmorPart(plates.leftThigh, "UpperLeg_L", targetBones);
                    AttachArmorPart(plates.rightThigh, "UpperLeg_R", targetBones);
                }
            }
            _bodyRenderer.sharedMesh = faceAndHands;
            _armorId = itemId;
        }

        private void AddDonorPart(GameObject donor, string name, Dictionary<string, Transform> targetBones)
        {
            if (donor == null) return;
            foreach (MeshRenderer part in donor.GetComponentsInChildren<MeshRenderer>(true))
                if (part.enabled && part.name.Contains(name))
                    AttachArmorPart(part.gameObject, part.transform.parent?.name, targetBones);
        }

        private void AttachArmorPart(GameObject source, string boneName,
                                     Dictionary<string, Transform> targetBones)
        {
            if (source == null || boneName == null || !targetBones.TryGetValue(boneName, out Transform bone)) return;
            GameObject part = Instantiate(source, bone, false);
            part.name = "PolygonApocalypse_ArmorPart:" + source.name;
            foreach (Collider collider in part.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (Transform node in part.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = gameObject.layer;
            _armorParts.Add(part);
        }

        private void RefreshAccessories()
        {
            if (_view == null || _visual == null) return;
            bool showBackpack = _view.HasLoadedEquipment("backpack", "backpack");
            string helmetId = LoadedItem("helmet", HelmetIds);
            GameObject helmetPrefab = RoaApocalypseModels.Item(helmetId);
            if (_helmet != null && helmetPrefab != _helmetPrefab)
                SetAccessory(ref _helmet, false, null, "Head");
            _helmetPrefab = helmetPrefab;
            SetAccessory(ref _backpack, showBackpack,
                RoaApocalypseModels.BackpackAttachment, "Spine_03");
            SetAccessory(ref _helmet, helmetPrefab != null, helmetPrefab, "Head");
            // Тиры шлема — один префаб: метка тира ставится при каждой смене предмета.
            if (_helmet != null) RoaApocalypseModels.MarkItem(_helmet, _view.EquippedItemId("helmet"));
            RefreshFootwear();
        }

        private void RefreshNativeHair()
        {
            // The animated pack body has its own hair mesh. The character's
            // appearance controller already knows whether a loaded helmet or
            // hood covers the original hair, so mirror that state here.
            SetNativeHairVisible(_view == null || _view.AnyHairVisible);
        }

        public void SetNativeHairVisible(bool visible)
        {
            foreach (GameObject hair in _nativeHair)
                if (hair != null && hair.activeSelf != visible) hair.SetActive(visible);
        }

        private void RefreshFootwear()
        {
            string itemId = LoadedItem("boots", FootwearIds);
            if (itemId == _footwearId) return;
            if (_footwearRoot != null)
            {
                _footwearRoot.SetActive(false);
                if (Application.isPlaying) Destroy(_footwearRoot);
                else DestroyImmediate(_footwearRoot);
                _footwearRoot = null;
            }
            foreach (GameObject part in _footwear)
            {
                if (part == null) continue;
                part.SetActive(false);
                if (Application.isPlaying) Destroy(part);
                else DestroyImmediate(part);
            }
            _footwear.Clear();
            _footwearId = itemId;
            RoaApocalypseModels.FootwearEntry selected = RoaApocalypseModels.Footwear(itemId);
            if (selected == null) return;
            AttachFootwearMesh(itemId, selected);
            AddFootwearPart(selected.leftKnee, "LowerLeg_L");
            AddFootwearPart(selected.rightKnee, "LowerLeg_R");
            AddFootwearPart(selected.leftThigh, "UpperLeg_L");
            AddFootwearPart(selected.rightThigh, "UpperLeg_R");
        }

        private void AttachFootwearMesh(string itemId, RoaApocalypseModels.FootwearEntry selected)
        {
            string body = _female ? "female_medium" : "male_medium";
            Mesh mesh = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/footwear_" + itemId + "_" + body);
            GameObject donor = _female ? selected.femalePrefab : selected.malePrefab;
            if (mesh == null || donor == null) return;
            SkinnedMeshRenderer source = null;
            foreach (SkinnedMeshRenderer renderer in donor.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (renderer.name == donor.name) { source = renderer; break; }
            if (source == null) return;
            var targetBones = new Dictionary<string, Transform>();
            foreach (Transform node in _visual.GetComponentsInChildren<Transform>(true))
                if (!targetBones.ContainsKey(node.name)) targetBones.Add(node.name, node);
            Transform[] bones = new Transform[source.bones.Length];
            for (int i = 0; i < bones.Length; i++)
                if (source.bones[i] == null || !targetBones.TryGetValue(source.bones[i].name, out bones[i]))
                    return;
            _footwearRoot = new GameObject("PolygonApocalypse_Footwear:" + itemId);
            _footwearRoot.transform.SetParent(_visual.transform, false);
            _footwearRoot.layer = gameObject.layer;
            var layer = _footwearRoot.AddComponent<SkinnedMeshRenderer>();
            layer.sharedMesh = mesh;
            layer.sharedMaterials = source.sharedMaterials;
            layer.bones = bones;
            if (source.rootBone != null && targetBones.TryGetValue(source.rootBone.name, out Transform rootBone))
                layer.rootBone = rootBone;
            layer.localBounds = mesh.bounds;
            layer.updateWhenOffscreen = true;
            layer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
        }

        private void UpdateIdentityMesh()
        {
            if (_bodyRenderer == null) return;
            string body = _female ? "female_medium" : "male_medium";
            string name = _armorId != null
                ? (_footwearId != null ? "base_no_feet_" : "base_") + body
                : _footwearId != null ? "body_no_feet_" + body : null;
            Mesh identity = name != null
                ? Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/" + name) : _originalBodyMesh;
            if (identity != null && _bodyRenderer.sharedMesh != identity)
                _bodyRenderer.sharedMesh = identity;
        }

        private void AddFootwearPart(GameObject prefab, string boneName)
        {
            GameObject current = null;
            SetAccessory(ref current, prefab != null, prefab, boneName);
            if (current != null) _footwear.Add(current);
        }

        private string LoadedItem(string slot, string[] ids)
        {
            foreach (string id in ids)
                if (_view.HasLoadedEquipment(slot, id)) return id;
            return null;
        }

        private void SetAccessory(ref GameObject current, bool visible, GameObject prefab, string boneName)
        {
            if (!visible || prefab == null)
            {
                if (current != null)
                {
                    current.SetActive(false);
                    if (Application.isPlaying) Destroy(current);
                    else DestroyImmediate(current);
                    current = null;
                }
                return;
            }
            if (current != null) return;
            Transform bone = null;
            foreach (Transform node in _visual.GetComponentsInChildren<Transform>(true))
                if (node.name == boneName) { bone = node; break; }
            if (bone == null) return;
            // Synty attachment meshes are authored in character-space bind pose.
            // Place them at the visual root first, then keep that world placement
            // while parenting to the animated bone.
            current = Instantiate(prefab, _visual.transform, false);
            var attachmentRenderers = current.GetComponentsInChildren<Renderer>(true);
            if (attachmentRenderers.Length > 0)
            {
                Bounds bounds = WorldBounds(attachmentRenderers);
                Vector3 center = boneName == "Spine_03"
                    ? bone.position - transform.forward * 0.22f
                    : boneName.StartsWith("LowerLeg")
                        ? bone.position - transform.up * 0.06f
                        : boneName.StartsWith("UpperLeg")
                            ? bone.position - transform.up * 0.18f
                            : bone.position + transform.up * 0.08f;
                current.transform.position += center - bounds.center;
            }
            current.transform.SetParent(bone, true);
            current.name = "PolygonApocalypse_" + boneName + "_Accessory";
            foreach (Transform node in current.GetComponentsInChildren<Transform>(true))
                node.gameObject.layer = gameObject.layer;
            foreach (Collider collider in current.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
        }

        private static int Depth(Transform value)
        {
            int count = 0;
            for (Transform item = value; item != null; item = item.parent) count++;
            return count;
        }
    }
}
