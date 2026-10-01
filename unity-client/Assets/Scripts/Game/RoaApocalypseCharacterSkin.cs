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
        private SkinnedMeshRenderer _armorLayer;
        private Mesh _armorGarment;
        private Mesh _armorGarmentFull;
        private string _armorId;
        private readonly List<GameObject> _armorParts = new List<GameObject>();
        private readonly List<HingedPart> _hingedParts = new List<HingedPart>();
        // Объём торса в надетой броне: вершины корпуса (Hips/Spine) в осях своих
        // костей — руку, ушедшую в броню, выводят наружу (локоть в сторону).
        private struct TorsoPoint
        {
            public Transform Bone;
            public Vector3 Local;
        }
        private readonly List<TorsoPoint> _torsoPoints = new List<TorsoPoint>();
        // Профиль торса в текущей позе: срезы по 2 см × сектора по 10°, в ячейке —
        // дальняя от оси корпуса точка брони. Строится раз за синхронизацию позы.
        private const float TorsoSlice = 0.02f;
        private const int TorsoSectors = 36;
        private float[] _torsoGrid = new float[0];
        private int _torsoSlices;
        private float _torsoBaseY;
        private Vector3 _torsoHipsAt, _torsoNeckAt;
        private int _torsoGridPose = -1;
        private int _poseSerial;
        private Mesh _torsoProfileMesh;
        private Transform _torsoHips;
        private Transform _torsoNeck;
        // Касание рукава о бок даёт ~0.05 (замер лукбука); глубже — рука в броне.
        private const float ArmTouchDepth = 0.04f;
        private const float ArmRadius = 0.05f;
        /// <summary>Для проб: глубина руки в броне до и после отвода локтя.</summary>
        public string DebugArmPushRight => DebugPush(_pushRight);
        public string DebugArmPushLeft => DebugPush(_pushLeft);
        private Vector3 _pushRight, _pushLeft;
        private static string DebugPush(Vector3 push) =>
            push.x.ToString("F2") + ">" + push.y.ToString("F2") + " x" + push.z.ToString("F0");

        /// <summary>
        /// Насколько кисть с рукоятью (предплечье у запястья) сидит в броне после
        /// отвода локтя, м. Оружие по нему отодвигается от груди (RoaWeaponView).
        /// </summary>
        public float ArmorGripDepth => Mathf.Max(_gripDepthRight, _gripDepthLeft);
        private float _gripDepthRight;
        // Левая кисть в хвате — не на оружии (противовес удара одной рукой, защита).
        private bool _leftFreeTarget;
        // Вынос оружия из брони, м (сглажен по кадрам).
        private float _gripShift;
        private int _gripShiftFrame = -1;
        // Кисть «на рукояти», если центр ладони не дальше ~1.5 см от места хвата.
        private const float GripReachTolerance = 0.015f;
        /// <summary>Для проб: на сколько оружие вынесено из брони, м.</summary>
        public float DebugGripShift => _gripShift;
        /// <summary>Предплечье от кисти к локтю в осях персонажа (последний хват), м.</summary>
        public Vector3 RightForearmLocal { get; private set; } = new Vector3(0.1f, -0.15f, -0.2f);
        public Vector3 LeftForearmLocal { get; private set; } = new Vector3(-0.1f, -0.15f, -0.2f);
        /// <summary>Запястье правой руки относительно центра её хвата, в осях персонажа.</summary>
        public Vector3 RightWristFromGrip { get; private set; }
        private float _gripDepthLeft;
        // Покой без оружия: доля «рук вдоль тела» (плавно входит и выходит).
        private float _hangWeight;
        private int _hangFrame = -1;
        // Шаг на выпаде: где стояли стопы в начале удара (в осях персонажа).
        private Vector3 _stepAnchorLeft;
        private Vector3 _stepAnchorRight;
        private bool _stepAnchored;
        private const float StepLength = 0.3f;
        private const float StepLift = 0.06f;
        /// <summary>Вынос передней стопы на выпаде сейчас, м (для проб).</summary>
        public float LungeStepOffset { get; private set; }

        /// <summary>A rigid plate hinged between the chest and the upper arm.</summary>
        private struct HingedPart
        {
            public Transform Part;
            public Transform Chest;
            public Transform Arm;
            public Matrix4x4 OnChest;
            public Matrix4x4 OnArm;
        }
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

        /// <summary>A pack attachment worn on a bone at a pose taken from the pack's own characters.</summary>
        private readonly struct WornPart
        {
            public readonly string Name;
            public readonly string Bone;
            public readonly Vector3 Position;
            public readonly Vector3 Euler;
            /// <summary>Position/Euler give the mesh centre and turn on the standing body, not on the bone.</summary>
            public readonly bool OnBody;

            public WornPart(string name, string bone, Vector3 position, Vector3 euler, bool onBody = false)
            {
                Name = name; Bone = bone; Position = position; Euler = euler; OnBody = onBody;
            }
        }

        // Poses copied from the pack's riot cop knee pads, and its thigh radio.
        private static readonly WornPart MetalKneeL = new WornPart("Armour_Knee_Metal_L_01", "LowerLeg_L",
            new Vector3(0.009f, -0.008f, -0.002f), new Vector3(285f, 0f, 90f));
        private static readonly WornPart MetalKneeR = new WornPart("Armour_Knee_Metal_R_01", "LowerLeg_R",
            new Vector3(-0.010f, 0.015f, 0.002f), new Vector3(75f, 180f, 90f));
        private static readonly WornPart MetalWristL = new WornPart("Armour_Wrist_Metal_L_01", "Elbow_L",
            Vector3.zero, Vector3.zero);
        private static readonly WornPart MetalWristR = new WornPart("Armour_Wrist_Metal_R_01", "Elbow_R",
            Vector3.zero, Vector3.zero);
        // Detectors ride the chest, where a long coat does not hide them: Mk1 a
        // small scanner, Mk2 the big radio set, Mk3 both.
        private static readonly WornPart DetectorSmall = new WornPart("Scout_Female_Radio_01", "Spine_03",
            new Vector3(-0.11f, 1.30f, 0.13f), Vector3.zero, true);
        private static readonly WornPart DetectorLarge = new WornPart("RiotCop_Male_Radio_01", "Spine_03",
            new Vector3(-0.11f, 1.30f, 0.14f), Vector3.zero, true);
        private static readonly WornPart DetectorSecond = new WornPart("Scout_Female_Radio_01", "Spine_03",
            new Vector3(0.12f, 1.31f, 0.13f), Vector3.zero, true);
        // Belt pouches: front left and right of the buckle, then the back right and left.
        private static readonly WornPart[] BeltPouches =
        {
            new WornPart("Pouch_02", "Hips", new Vector3(-0.075f, 0.93f, 0.13f), Vector3.zero, true),
            new WornPart("Pouch_03", "Hips", new Vector3(0.075f, 0.95f, 0.13f), Vector3.zero, true),
            new WornPart("Pouch_01", "Hips", new Vector3(0.08f, 0.94f, -0.17f), new Vector3(0f, 180f, 0f), true),
            new WornPart("Pouch_02", "Hips", new Vector3(-0.08f, 0.93f, -0.17f), new Vector3(0f, 180f, 0f), true)
        };
        private static readonly string[] DetectorIds = { "artifactDetectorMk1", "artifactDetectorMk2", "artifactDetectorMk3" };
        private static readonly string[] BeltIds = { "artifactBelt2", "artifactBelt3", "artifactBelt4" };
        private readonly List<GameObject> _utilityParts = new List<GameObject>();
        private string _utilityKey;
        // Headgear authored on the head bone (masks, the helmet with a gas mask)
        // sits there as the pack placed it instead of being centred on the skull.
        private static readonly string[] HeadBoneHelmets = { "weldedHelmet", "preWarHelmet" };
        private string _helmetLook;

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
            SyncBones();
            FollowHingedParts();
        }

        private void SyncBones()
        {
            _poseSerial++;
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
            if (_view != null && (_view.Dead || _view.CurrentClip == "death")) KeepHandsAboveFloor();
            LungeStep();
            PlantFoot(_leftLeg, _leftBall);
            PlantFoot(_rightLeg, _rightBall);
            // Limb proportions differ: a held weapon hangs on the source hands, so
            // the visible hands reach them, keeping the retargeted wrist and elbow.
            bool armed = _view != null && (!string.IsNullOrEmpty(_view.WeaponId) || _view.OffhandWeaponReady);
            Armed = armed;
            HoldMissPrimary = -1f;
            HoldMissSupport = -1f;
            HoldArchetype = string.Empty;
            if (!armed)
            {
                _gripDepthRight = _gripDepthLeft = 0f;
                RelaxFreeHands();
                PunchLine();
                DrinkFromHand();
                return;
            }
            RoaWeaponView weapon = _view.HeldWeapon;
            if (weapon != null && weapon.HoldActive && (weapon.HoldRight.Active || weapon.HoldLeft.Active))
            {
                // Кисти — на места рук самой модели, пальцы обхватывают рукоять;
                // свободная рука остаётся за клипом.
                HoldArchetype = weapon.HoldKind;
                _pushRight = _pushLeft = Vector3.zero;
                HoldMissPrimary = Hold(_rightArm, _rightGrip, weapon.HoldRight, false);
                RoaHandTarget left = weapon.HoldLeft;
                RoaOffhandWeaponView offhand = _view.HeldOffhand;
                _leftFreeTarget = !weapon.LeftOnWeapon && (offhand == null || !offhand.HoldLeft.Active);
                if (!left.Active && offhand != null && offhand.HoldLeft.Active) left = offhand.HoldLeft;
                HoldMissSupport = Hold(_leftArm, _leftGrip, left, true);
                // Объёмная броня: рукоять у груди, и запястье с предплечьем сидят в торсе
                // даже с отведённым локтем — оружие вместе с кистями уходит вперёд.
                // Сдвиг считается по позе без сдвига (кадр за кадром устойчив) и
                // сглаживается; вперёд на s глубина у бока падает примерно на 0.7·s.
                // Кисти должны дотянуться: вынос, при котором рука не достаёт до своей
                // рукояти (тяжёлый пулемёт у бедра, копьё), делится пополам, пока не достанет.
                // Повторная синхронизация в том же кадре оружие уже сдвинутым и застаёт.
                // Позу за кадр пересчитывают не раз (скин, превью перед отрисовкой), и
                // оружие к этому моменту может быть уже сдвинуто: вынос считается от
                // уже приложенного — вперёд на s глубина у бока падает примерно на 0.7·s.
                // Огнестрел и бита выносятся вперёд и наружу от корпуса у глубже сидящей
                // руки; древко и клинок — только вперёд (вбок древко тянуло бы нижнюю кисть
                // поперёк живота).
                Vector3 chestForward = Vector3.ProjectOnPlane(transform.forward, Vector3.up).normalized;
                bool gun = HoldArchetype == "LongGun" || HoldArchetype == "Pistol" || HoldArchetype == "SawedOff"
                    || HoldArchetype == "HipGun";
                bool leftDeeper = _pushLeft.y > Mathf.Max(_pushRight.y, _gripDepthRight);
                RoaHandGrip deeperGrip = leftDeeper ? _leftGrip : _rightGrip;
                if ((gun || HoldArchetype == "Bat") && _torsoPoints.Count > 0 && deeperGrip != null && deeperGrip.Ready
                    && _torsoGridPose == _poseSerial)
                {
                    Vector3 wristAt = deeperGrip.Hand.position;
                    Vector3 away = Vector3.ProjectOnPlane(wristAt - TorsoAxis(wristAt.y), Vector3.up);
                    if (away.sqrMagnitude > 1e-4f) chestForward = (away.normalized + chestForward).normalized;
                }
                float applied = Vector3.Dot(weapon.ArmorShift, chestForward);
                float shift = 0f;
                // Клюшка и бита держатся низко у живота: им нужно дальше.
                float limit = HoldArchetype == "Bat" ? 0.24f : 0.12f;
                if (weapon.HoldRight.Active && (offhand == null || !offhand.HoldLeft.Active))
                {
                    if (_torsoPoints.Count > 0)
                    {
                        // Глубже всего сидящая часть рук после отвода локтя: запястье у рукояти
                        // или плечо у брони (бита у груди, левая рука у древка и зенитки).
                        // Древко двумя руками: вынос вперёд тянет нижнюю руку вдоль брони — только запястья.
                        float deepest = HoldArchetype == "TwoHand" ? ArmorGripDepth
                            : Mathf.Max(ArmorGripDepth, Mathf.Max(_pushRight.y, _pushLeft.y));
                        shift = Mathf.Clamp(applied + (deepest - 0.02f) / 0.85f, 0f, limit);
                    }
                    // Огнестрел: локоть не складывается острее ~60° — рукоять чуть дальше от плеча.
                    if (gun)
                    {
                        float fold = Mathf.Min(ElbowAngle(_rightGrip), weapon.HoldLeft.Active ? ElbowAngle(_leftGrip) : 180f);
                        if (fold < 60f) shift = Mathf.Max(shift, Mathf.Min(applied + (60f - fold) * 0.003f, limit));
                    }
                }
                // Свежепоставленное оружие: к новому выносу плавно, от прошлого кадра.
                if (applied <= 0f && _gripShiftFrame != Time.frameCount) shift = Mathf.Lerp(_gripShift, shift, 0.35f);
                _gripShiftFrame = Time.frameCount;
                for (int attempt = 0; attempt < 4; attempt++)
                {
                    if (Mathf.Abs(shift - applied) > 0.001f)
                    {
                        weapon.ShiftHold(chestForward * (shift - applied));
                        applied = shift;
                        HoldMissPrimary = Hold(_rightArm, _rightGrip, weapon.HoldRight, false);
                        left = weapon.HoldLeft;
                        HoldMissSupport = Hold(_leftArm, _leftGrip, left, true);
                    }
                    if (applied <= 0.001f || (HoldMissPrimary <= GripReachTolerance && (_leftFreeTarget || HoldMissSupport <= GripReachTolerance))) break;
                    // Кисть не достаёт до рукояти (пулемёт у бедра, копьё): вынос вдвое меньше, потом ноль.
                    shift = attempt < 2 ? applied * 0.5f : 0f;
                }
                _gripShift = applied;
                // Свободная кисть (щит — правая, удар одной рукой — левая) — мягкий полукулак;
                // рука при щите почти не машет.
                if (!weapon.HoldRight.Active && _rightGrip != null)
                {
                    CalmArm(_rightGrip, 0.5f);
                    ClearFreeArm(_rightGrip, 0.5f, transform.right);
                    _rightGrip.ApplyFingers(RoaFingerPose.Relaxed, 0.03f);
                }
                if (!left.Active && _leftGrip != null)
                {
                    // Удар одной рукой и бросок: свободная рука держит защиту перед левой
                    // грудью. По клипу она болталась и на скрутке корпуса уходила в живот.
                    if (HoldArchetype == "OneHand" || HoldArchetype == "Knife" || HoldArchetype == "Tonfa"
                        || HoldArchetype == "Throwable")
                        GuardFreeLeft();
                    _leftGrip.ApplyFingers(RoaFingerPose.Relaxed, 0.03f);
                }
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
                    // Тяжёлый кейс: рука почти не машет и чуть отведена, кейс не бьёт по бедру.
                    CalmArm(_rightGrip, 0.9f, transform.right * 0.12f);
                    ClearFreeArm(_rightGrip, 0.9f, transform.right, 0.12f);
                    // Ручка — в сгибе пальцев: на 2.8 см дальше центра ладони к пальцам.
                    _rightGrip.HeldFrame(0.004f, out Vector3 centre, out Vector3 axis, out _, 0.028f);
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

        /// <summary>Лёжа кисти не уходят под пол: рука приподнимается в плече.</summary>
        private void KeepHandsAboveFloor()
        {
            // Пол — у родителя: мёртвое тело сдвигается по высоте поправкой земли.
            float floor = (transform.parent != null ? transform.parent.position.y : transform.position.y) + 0.03f;
            foreach (RoaHandGrip grip in new[] { _rightGrip, _leftGrip })
            {
                if (grip == null || !grip.Ready || grip.Hand.parent == null || grip.Hand.parent.parent == null) continue;
                Transform shoulder = grip.Hand.parent.parent;
                Vector3 arm = grip.Hand.position - shoulder.position;
                if (grip.Hand.position.y >= floor || arm.sqrMagnitude < 1e-4f) continue;
                // Точно: рука той же длины поворачивается в вертикальной плоскости, пока
                // кисть не встанет на высоту пола над плечом.
                float length = arm.magnitude;
                float want = Mathf.Min(floor - shoulder.position.y, length);
                Vector3 flat = Vector3.ProjectOnPlane(arm, Vector3.up);
                if (flat.sqrMagnitude < 1e-6f) flat = transform.forward;
                Vector3 target = flat.normalized * Mathf.Sqrt(Mathf.Max(0f, length * length - want * want)) + Vector3.up * want;
                shoulder.rotation = Quaternion.FromToRotation(arm, target) * shoulder.rotation;
            }
        }

        /// <summary>
        /// Шаг на выпаде, когда удар наносится стоя: передняя (левая) стопа уходит
        /// вперёд на ~30 см к контакту и возвращается, задняя стоит на месте, пока таз
        /// идёт в выпад (без этого стопы ехали вместе с тазом). На ходу ногами
        /// управляет походка — шага нет.
        /// </summary>
        private void LungeStep()
        {
            LungeStepOffset = 0f;
            RoaWeaponView weapon = _view != null ? _view.HeldWeapon : null;
            // Удар кулаком стоя: клип бокса возит заднюю стопу по полу — стопы стоят.
            bool punchPlant = _view != null && _view.PunchActive && !_view.UpperBodyPunch;
            float phase = weapon != null && weapon.HoldActive ? weapon.DebugAttackPhase : punchPlant ? 0f : -1f;
            float scale = weapon != null && !punchPlant ? StepScale(weapon.HoldKind) : 0f;
            // Бросок без шага, но стопы стоят, пока корпус работает (не едут по полу).
            bool plantOnly = (weapon != null && weapon.HoldKind == "Throwable") || punchPlant;
            if (phase < 0f || (scale <= 0f && !plantOnly) || Moving() || _leftLeg == null || _rightLeg == null
                || !_leftLeg.Ready || !_rightLeg.Ready)
            {
                _stepAnchored = false;
                return;
            }
            Transform leftAnkle = _leftLeg.End, rightAnkle = _rightLeg.End;
            if (!_stepAnchored)
            {
                _stepAnchorLeft = transform.InverseTransformPoint(leftAnkle.position);
                _stepAnchorRight = transform.InverseTransformPoint(rightAnkle.position);
                _stepAnchored = true;
            }
            float w = StepWeight(phase);
            LungeStepOffset = StepLength * scale * w;
            // Таз идёт за шагом — вперёд и вниз, ведущее колено сгибается над стопой.
            Transform pelvis = PelvisTarget();
            if (pelvis != null && scale > 0f)
                pelvis.position += transform.forward * (0.08f * w * scale) - transform.up * (0.05f * w * scale);
            Vector3 lead = _stepAnchorLeft + Vector3.forward * LungeStepOffset
                + Vector3.up * (StepLift * 4f * w * (1f - w) * scale);
            _leftLeg.Solve(transform.TransformPoint(lead), leftAnkle.rotation,
                leftAnkle.parent.position + transform.forward * 0.5f);
            _rightLeg.Solve(transform.TransformPoint(_stepAnchorRight), rightAnkle.rotation,
                rightAnkle.parent.position + transform.forward * 0.5f);
        }

        private Transform PelvisTarget()
        {
            foreach (BonePair pair in _bones)
                if (pair.Pelvis) return pair.Target;
            return null;
        }

        /// <summary>Шаг по фазе удара: подшаг к контакту (стопа встаёт к 0.52, не едет по полу), стоит на проходе, возврат.</summary>
        private static float StepWeight(float phase)
        {
            if (phase < 0.3f) return 0f;
            if (phase < 0.52f) return Smooth01((phase - 0.3f) / 0.22f);
            if (phase < 0.74f) return 1f;
            return 1f - Smooth01((phase - 0.74f) / 0.26f);
        }

        private static float Smooth01(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3f - 2f * t);
        }

        /// <summary>Каким ударам нужен шаг: укол, толчок, рубка — полный; бита — вполовину (удар бёдрами).</summary>
        private static float StepScale(string kind)
        {
            switch (kind)
            {
                case "Knife": case "Spear": case "Tonfa": case "Shield": case "PowerTool":
                case "OneHand": case "TwoHand": case "Sword":
                    return 1f;
                case "Bat":
                    return 0.5f;
                default:
                    return 0f;
            }
        }

        private bool Moving()
        {
            string clip = _view != null ? _view.CurrentClip ?? string.Empty : string.Empty;
            return clip.StartsWith("walk", System.StringComparison.Ordinal)
                || clip.StartsWith("run", System.StringComparison.Ordinal)
                || clip.StartsWith("strafe", System.StringComparison.Ordinal)
                || clip.StartsWith("crouch_walk", System.StringComparison.Ordinal)
                || clip.StartsWith("crouch_run", System.StringComparison.Ordinal);
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
            if (toe.sqrMagnitude < 1e-4f) return;
            Vector3 axis = Vector3.Cross(toe, Vector3.up);
            if (axis.sqrMagnitude < 1e-6f) return;
            if (ball.position.y < ballFloor)
            {
                float lift = Mathf.Asin(Mathf.Clamp((ballFloor - ball.position.y) / toe.magnitude, 0f, 1f)) * Mathf.Rad2Deg;
                ankle.rotation = Quaternion.AngleAxis(lift, axis.normalized) * ankle.rotation;
            }
            else if (ankle.position.y < lowest + 0.05f && ball.position.y < ballFloor + 0.07f)
            {
                // Опорная стопа с зависшим носком (присед, стойка): носок ложится на пол.
                float press = Mathf.Asin(Mathf.Clamp((ball.position.y - ballFloor) / toe.magnitude, 0f, 1f)) * Mathf.Rad2Deg;
                ankle.rotation = Quaternion.AngleAxis(-press, axis.normalized) * ankle.rotation;
            }
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
            // Двуручное древко и труба на плече: левая кисть у середины корпуса, и локоть
            // «внутрь» уходил в живот — там он идёт наружу-вниз и чуть вперёд, перед грудью.
            bool outerLeft = left && (HoldArchetype == "Bat" || HoldArchetype == "TwoHand"
                || HoldArchetype == "Sword" || HoldArchetype == "Spear" || HoldArchetype == "Launcher"
                || HoldArchetype == "Pistol" || HoldArchetype == "SawedOff" || HoldArchetype == "HipGun"
                || HoldArchetype == "Shield" || HoldArchetype == "OneHand" || HoldArchetype == "Knife"
                || HoldArchetype == "Tonfa" || HoldArchetype == "Throwable");
            Vector3 bend = target.HasElbow ? target.Elbow
                : outerLeft ? -transform.right * ((HoldArchetype == "Sword" || HoldArchetype == "TwoHand") && !LongHaft() ? 0.2f : 0.4f)
                    + Vector3.down + transform.forward * 0.3f
                // Левый локоть под цевьём — внутрь, к оружию; правый — вниз и чуть наружу.
                : transform.right * (left ? (target.Fingers == RoaFingerPose.Cradle ? 0.45f : 0.15f) : 0.32f)
                    + Vector3.down - transform.forward * 0.12f;
            if (shoulder == null || !TwoBone(shoulder, elbow, grip.Hand, wrist, rotation, bend))
                arm.Solve(wrist, rotation, (shoulder != null ? shoulder.position : transform.position) + bend);
            // Кисть стоит на рукояти, а плечо или предплечье ушли в броню — локоть
            // отводится наружу, пока рука не выйдет на поверхность торса.
            if (shoulder != null && EnsureTorsoProfile())
            {
                Vector3 outward = left ? -transform.right : transform.right;
                float depth = ArmDepth(shoulder, elbow, grip.Hand);
                float start = depth;
                // Отвод пробуется до четырёх шагов (у почти прямой руки локоть на первом
                // шаге может перескочить на другую сторону); остаётся лучший.
                Vector3 best = bend, trial = bend;
                int steps = 0;
                for (int step = 1; step <= 4 && depth > ArmTouchDepth; step++)
                {
                    trial += outward * 0.35f;
                    TwoBone(shoulder, elbow, grip.Hand, wrist, rotation, trial);
                    // Локоть не задирается крылом над линией плечо—кисть: у опущенной руки
                    // (пулемёт у бедра) не выше 3 см, у поднятой (противовес, пистолет) — 4 см.
                    Vector3 line = grip.Hand.position - shoulder.position;
                    Vector3 off = (elbow.position - shoulder.position) - Vector3.Project(elbow.position - shoulder.position, line);
                    if (off.y > (line.y < -0.25f ? 0.03f : 0.04f)) break;
                    float next = ArmDepth(shoulder, elbow, grip.Hand);
                    if (next < depth - 0.003f)
                    {
                        depth = next;
                        best = trial;
                        steps = step;
                    }
                }
                bend = best;
                TwoBone(shoulder, elbow, grip.Hand, wrist, rotation, bend);
                // Свободная левая (противовес, защита) не держит оружие: если локоть не
                // вывел её из брони, наружу уходит сама кисть.
                if (left && _leftFreeTarget)
                    for (int step = 1; step <= 3 && depth > ArmTouchDepth; step++)
                    {
                        TwoBone(shoulder, elbow, grip.Hand, wrist + outward * (0.04f * step), rotation, bend);
                        depth = ArmDepth(shoulder, elbow, grip.Hand);
                    }
                if (left) _pushLeft = new Vector3(start, depth, steps); else _pushRight = new Vector3(start, depth, steps);
                float gripDepth = ArmDepth(shoulder, elbow, grip.Hand, 0.7f);
                Vector3 forearm = transform.InverseTransformDirection(elbow.position - grip.Hand.position);
                if (left) LeftForearmLocal = forearm; else RightForearmLocal = forearm;
                if (!left) RightWristFromGrip = transform.InverseTransformDirection(grip.Hand.position - target.Centre);
                if (left) _gripDepthLeft = gripDepth; else _gripDepthRight = gripDepth;
            }
            grip.ApplyFingers(target.Fingers, target.Radius);
            return Vector3.Distance(grip.PalmCentre(target.Radius), target.Centre);
        }

        /// <summary>
        /// Защита свободной левой руки: кулак в ~30 см перед левым плечом и на 30 см
        /// ниже него, локоть наружу-вниз. Точка считается от плеча, поэтому идёт за
        /// скруткой корпуса в ударе и не проваливается в грудь.
        /// </summary>
        private void GuardFreeLeft()
        {
            Transform hand = _visibleLeftHand;
            Transform elbow = hand != null ? hand.parent : null;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return;
            Vector3 chestForward = Vector3.ProjectOnPlane(shoulder.parent != null ? shoulder.parent.forward : transform.forward, Vector3.up);
            if (chestForward.sqrMagnitude < 1e-4f) chestForward = transform.forward;
            chestForward = Vector3.Slerp(transform.forward, chestForward.normalized, 0.5f).normalized;
            Vector3 chestRight = Vector3.Cross(Vector3.up, chestForward);
            Vector3 target = shoulder.position + chestForward * 0.3f + Vector3.down * 0.3f + chestRight * 0.08f;
            Vector3 bend = -chestRight * 0.6f + Vector3.down + chestForward * 0.15f;
            TwoBone(shoulder, elbow, hand, target, hand.rotation, bend);
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

        /// <summary>
        /// Пустые руки: пальцы — мягкий полукулак (в ударе — кулак), а на ходу мах
        /// руки ограничен, как у человека: плечо вперёд не больше ~20° на шаге и ~40° на
        /// бегу, локоть не сгибается «подносом», ладонь смотрит к бедру, не вверх.
        /// </summary>
        private void RelaxFreeHands()
        {
            string clip = _view != null ? _view.CurrentClip : string.Empty;
            bool punching = clip == "attack" || clip == "punch_cross" || (_view != null && _view.PunchActive);
            bool running = clip == "run" || clip == "run_back" || clip == "crouch_run" || clip == "crouch_run_back";
            bool crouchWalk = clip == "crouch_walk" || clip == "crouch_walk_back" || clip == "crouch_idle";
            bool walking = clip == "walk" || clip == "walk_back" || clip.StartsWith("strafe_", System.StringComparison.Ordinal)
                || crouchWalk;
            // Мах считается от груди, а не от ног: бегущий боком машет руками вдоль
            // своего корпуса, а не «крылом» поперёк.
            Vector3 chestRight = transform.right;
            if (_rightGrip != null && _leftGrip != null && _rightGrip.Ready && _leftGrip.Ready
                && _rightGrip.Hand.parent != null && _leftGrip.Hand.parent != null)
            {
                Vector3 across = Vector3.ProjectOnPlane(_rightGrip.Hand.parent.parent.position
                    - _leftGrip.Hand.parent.parent.position, Vector3.up);
                if (across.sqrMagnitude > 1e-4f) chestRight = across.normalized;
            }
            Vector3 chestForward = Vector3.Cross(chestRight, Vector3.up);
            // Клип покоя держит руки «крутым парнем»: локоть 135°, кисти в 12 см от
            // бёдер и загнуты наружу. Стоя без дела руки висят вдоль тела.
            bool resting = (clip == "idle" || clip == "turn") && !punching;
            if (Time.frameCount != _hangFrame)
            {
                _hangFrame = Time.frameCount;
                _hangWeight = Mathf.MoveTowards(_hangWeight, resting ? 1f : 0f, Mathf.Clamp(Time.deltaTime, 0f, 0.1f) * 4f);
            }
            float hang = _hangWeight * _hangWeight * (3f - 2f * _hangWeight);
            foreach ((RoaHandGrip grip, bool left) in new[] { (_rightGrip, false), (_leftGrip, true) })
            {
                if (grip == null || !grip.Ready) continue;
                if (hang > 0.001f) HangArm(grip, left, hang);
                // Удар на ходу ведёт клип удара, а не мах шага.
                if ((running || walking) && !punching)
                    LimitSwing(grip, left, clip == "walk_back" ? 10f : clip == "run_back" ? 25f : running ? 40f : 20f,
                        clip == "run_back" ? 45f : running ? 95f : clip == "walk_back" ? 15f : 30f, chestForward, chestRight,
                        crouchWalk ? 35f : 0f, crouchWalk ? 12f : 1f);
                if (punching) grip.ApplyFingers(RoaFingerPose.Wrap, 0.004f);
                else grip.ApplyFingers(RoaFingerPose.Loose, 0.03f);
            }
        }

        /// <summary>
        /// Удар кулаком — по линии на цель: клип бокса ведёт кулак наискось в сторону
        /// (джеб — на ~55° влево), и рука в пике выпрямляется до упора. По мере
        /// выпрямления кулак доворачивается к оси вперёд (высота удара — из клипа), а
        /// вылет ограничен: локоть в пике не больше ~160°.
        /// </summary>
        private void PunchLine()
        {
            if (_view == null || !_view.PunchActive) return;
            bool jab = _view.PunchClip == "attack";
            RoaIkChain arm = jab ? _leftArm : _rightArm;
            if (arm == null || !arm.Ready) return;
            Transform hand = arm.End;
            Transform elbow = hand != null ? hand.parent : null;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return;
            float length = Vector3.Distance(shoulder.position, elbow.position) + Vector3.Distance(elbow.position, hand.position);
            Vector3 reach = hand.position - shoulder.position;
            float distance = reach.magnitude;
            if (length <= 0.01f || distance <= 0.01f) return;
            float w = Mathf.Clamp01((distance / length - 0.55f) / 0.3f);
            if (w <= 0f) return;
            float side = jab ? -1f : 1f;
            Vector3 up = transform.up;
            Vector3 flat = Vector3.ProjectOnPlane(reach, up);
            Vector3 line = (transform.forward + transform.right * (side * 0.12f)).normalized;
            Vector3 want = line * flat.magnitude + up * Vector3.Dot(reach, up);
            Vector3 dir = Vector3.Slerp(reach / distance, want.normalized, w).normalized;
            Vector3 target = shoulder.position + dir * Mathf.Min(distance, length * 0.985f);
            Quaternion turn = Quaternion.FromToRotation(reach, dir);
            arm.Solve(target, turn * hand.rotation,
                elbow.position - up * 0.2f + transform.right * (side * 0.1f));
        }

        /// <summary>
        /// Еда и питьё (клип consume, UAL): кисть в клипе поднимается к лицу, но
        /// держит её перед грудью ладонью вверх. Здесь левая кисть на время глотка
        /// подносит бутылку к губам горлышком ко рту, голова чуть запрокинута.
        /// </summary>
        private void DrinkFromHand()
        {
            if (_view == null || _view.CurrentClip != "consume" || _leftGrip == null || !_leftGrip.Ready
                || _leftArm == null || _visibleHead == null) return;
            float phase = _view.CurrentClipPhase;
            float up = Mathf.Clamp01((phase - 0.08f) / 0.17f);
            float down = Mathf.Clamp01((0.8f - phase) / 0.12f);
            float w = Mathf.Min(up * up * (3f - 2f * up), down * down * (3f - 2f * down));
            if (w < 0.01f) return;
            // Бутылку пьют запрокинув голову (клип сам отклоняет её — здесь добавка до
            // ~18°), локоть поднят вперёд.
            TiltHead(-20f * w, 0f);
            Vector3 forward = transform.forward;
            Vector3 mouth = _visibleHead.position + forward * 0.13f - transform.up * 0.09f;
            Vector3 bottle = mouth + forward * 0.05f - transform.up * 0.1f - transform.right * 0.02f;
            _leftGrip.HeldFrame(0.03f, out Vector3 centre, out Vector3 axis, out Vector3 back);
            Vector3 toMouth = (mouth - bottle).normalized;
            Vector3 outward = (-transform.right + forward * 0.5f).normalized;
            RoaHandTarget drink = new RoaHandTarget
            {
                Active = true,
                Centre = Vector3.Lerp(centre, bottle, w),
                Axis = Vector3.Slerp(axis, toMouth, w).normalized,
                Back = Vector3.Slerp(back, outward, w).normalized,
                Radius = 0.03f,
                Fingers = RoaFingerPose.Wrap,
                Elbow = Vector3.down * 0.8f + forward * 0.5f - transform.right * 0.3f,
                HasElbow = true
            };
            Hold(_leftArm, _leftGrip, drink, true);
        }

        /// <summary>
        /// Рука висит вдоль тела: плечо почти отвесно, локоть ~165° и смотрит назад,
        /// кисть в ~6 см снаружи от линии плеча (мимо бедра и брони), ладонь к бедру,
        /// запястье прямое. weight смешивает с позой клипа.
        /// </summary>
        private void HangArm(RoaHandGrip grip, bool left, float weight)
        {
            Transform hand = grip.Hand;
            Transform elbow = hand != null ? hand.parent : null;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return;
            float length = Vector3.Distance(shoulder.position, elbow.position) + Vector3.Distance(elbow.position, hand.position);
            Vector3 outward = left ? -transform.right : transform.right;
            Vector3 forward = transform.forward;
            const float side = 0.06f, ahead = 0.03f;
            float reach = length * 0.985f;
            float drop = Mathf.Sqrt(Mathf.Max(0.01f, reach * reach - side * side - ahead * ahead));
            Vector3 wrist = shoulder.position + outward * side + forward * ahead - Vector3.up * drop;
            // Кисть — продолжение предплечья: пальцы вниз, указательный вперёд, тыл наружу.
            Quaternion relaxed = grip.RotationFor(forward, outward);
            Vector3 target = Vector3.Lerp(hand.position, wrist, weight);
            Quaternion rotation = Quaternion.Slerp(hand.rotation, relaxed, weight);
            Vector3 bend = -forward + outward * 0.3f + Vector3.down * 0.2f;
            TwoBone(shoulder, elbow, hand, target, rotation, bend);
            // Объёмная броня (живот «Лома», скафандр): рука висит снаружи неё.
            if (!EnsureTorsoProfile()) return;
            // Отвод идёт по сфере вокруг плеча: рука не вытягивается в палку.
            for (int step = 1; step <= 4 && Mathf.Max(ArmDepth(shoulder, elbow, hand), ArmDepth(shoulder, elbow, hand, 0.7f)) > ArmTouchDepth; step++)
            {
                float wide = side + 0.025f * step;
                float lower = Mathf.Sqrt(Mathf.Max(0.01f, reach * reach - wide * wide - ahead * ahead));
                Vector3 outside = shoulder.position + outward * wide + forward * ahead - Vector3.up * lower;
                TwoBone(shoulder, elbow, hand, Vector3.Lerp(hand.position, outside, weight), rotation, bend);
            }
        }

        /// <summary>
        /// Снять профиль торса с надетой брони: вершины корпуса запоминаются в осях
        /// своих костей и дальше идут за позой. Нет брони или сетка нечитаема — false.
        /// </summary>
        private bool EnsureTorsoProfile()
        {
            Mesh mesh = _armorLayer != null && _armorLayer.enabled ? _armorLayer.sharedMesh : null;
            if (mesh != _torsoProfileMesh)
            {
                _torsoProfileMesh = mesh;
                _torsoPoints.Clear();
                if (mesh != null && mesh.isReadable)
                {
                    var baked = new Mesh();
                    _armorLayer.BakeMesh(baked, true);
                    Vector3[] vertices = baked.vertices;
                    BoneWeight[] weights = mesh.boneWeights;
                    Transform[] bones = _armorLayer.bones;
                    Matrix4x4 toWorld = Matrix4x4.TRS(_armorLayer.transform.position, _armorLayer.transform.rotation, Vector3.one);
                    for (int i = 0; i < vertices.Length && i < weights.Length; i++)
                    {
                        BoneWeight w = weights[i];
                        Transform bone = w.boneIndex0 >= 0 && w.boneIndex0 < bones.Length ? bones[w.boneIndex0] : null;
                        if (bone == null || !(bone.name == "Hips" || bone.name.StartsWith("Spine", System.StringComparison.Ordinal)
                            || bone.name.StartsWith("UpperLeg", System.StringComparison.Ordinal))) continue;
                        float arm = ArmShare(bones, w.boneIndex0, w.weight0) + ArmShare(bones, w.boneIndex1, w.weight1)
                            + ArmShare(bones, w.boneIndex2, w.weight2) + ArmShare(bones, w.boneIndex3, w.weight3);
                        if (arm >= 0.2f) continue;
                        _torsoPoints.Add(new TorsoPoint { Bone = bone, Local = bone.InverseTransformPoint(toWorld.MultiplyPoint3x4(vertices[i])) });
                    }
                    if (Application.isPlaying) Destroy(baked);
                    else DestroyImmediate(baked);
                    // Жёсткие щитки на корпусе и бёдрах (набедренник «Лома»): кисть висит снаружи.
                    foreach (GameObject part in _armorParts)
                    {
                        if (part == null || part.name.Contains("Shoulder") || part.name.Contains("Wrist")) continue;
                        foreach (MeshFilter filter in part.GetComponentsInChildren<MeshFilter>(true))
                        {
                            Mesh plate = filter.sharedMesh;
                            if (plate == null || !plate.isReadable) continue;
                            Transform bone = filter.transform.parent;
                            while (bone != null && !(bone.name == "Hips" || bone.name.StartsWith("Spine", System.StringComparison.Ordinal)
                                || bone.name.StartsWith("UpperLeg", System.StringComparison.Ordinal)))
                                bone = bone.parent;
                            if (bone == null) continue;
                            foreach (Vector3 v in plate.vertices)
                                _torsoPoints.Add(new TorsoPoint { Bone = bone, Local = bone.InverseTransformPoint(filter.transform.TransformPoint(v)) });
                        }
                    }
                    _torsoHips = FindVisualBone("Hips");
                    _torsoNeck = FindVisualBone("Neck");
                }
                _torsoGridPose = -1;
            }
            return _torsoPoints.Count > 0 && _torsoHips != null && _torsoNeck != null;
        }

        private static float ArmShare(Transform[] bones, int index, float weight)
        {
            if (index < 0 || index >= bones.Length || bones[index] == null) return 0f;
            string name = bones[index].name;
            return name.StartsWith("Shoulder", System.StringComparison.Ordinal) || name.StartsWith("Elbow", System.StringComparison.Ordinal)
                || name.StartsWith("Hand", System.StringComparison.Ordinal) ? weight : 0f;
        }

        /// <summary>
        /// Насколько рука (низ плеча и предплечье до запястья) ушла внутрь брони, м:
        /// в горизонтальном срезе на высоте точки поверхность торса в её направлении
        /// сравнивается с расстоянием до оси корпуса минус толщина руки.
        /// </summary>
        private void BuildTorsoGrid()
        {
            if (_torsoGridPose == _poseSerial) return;
            _torsoGridPose = _poseSerial;
            _torsoHipsAt = _torsoHips.position;
            _torsoNeckAt = _torsoNeck.position;
            _torsoBaseY = _torsoHipsAt.y - 0.4f;
            _torsoSlices = Mathf.Max(1, Mathf.CeilToInt((_torsoNeckAt.y + 0.04f - _torsoBaseY) / TorsoSlice));
            int cells = _torsoSlices * TorsoSectors;
            if (_torsoGrid.Length < cells) _torsoGrid = new float[cells];
            System.Array.Clear(_torsoGrid, 0, cells);
            for (int i = 0; i < _torsoPoints.Count; i++)
            {
                Vector3 q = _torsoPoints[i].Bone.TransformPoint(_torsoPoints[i].Local);
                int slice = Mathf.FloorToInt((q.y - _torsoBaseY) / TorsoSlice);
                if (slice < 0 || slice >= _torsoSlices) continue;
                Vector3 axis = TorsoAxis(q.y);
                float dx = q.x - axis.x, dz = q.z - axis.z;
                float radius = Mathf.Sqrt(dx * dx + dz * dz);
                int cell = slice * TorsoSectors + Sector(dx, dz);
                if (radius > _torsoGrid[cell]) _torsoGrid[cell] = radius;
            }
        }

        private Vector3 TorsoAxis(float y) =>
            Vector3.Lerp(_torsoHipsAt, _torsoNeckAt, Mathf.InverseLerp(_torsoHipsAt.y, _torsoNeckAt.y, y));

        private static int Sector(float dx, float dz)
        {
            float angle = Mathf.Atan2(dz, dx) * Mathf.Rad2Deg + 180f;
            return Mathf.Clamp(Mathf.FloorToInt(angle / (360f / TorsoSectors)), 0, TorsoSectors - 1);
        }

        /// <summary>
        /// Насколько шар радиуса radius в точке p сидит в надетой броне, м (≤0 —
        /// снаружи; −1 — брони с профилем нет). Для выноса оружия от груди.
        /// </summary>
        public float TorsoDepth(Vector3 p, float radius)
        {
            if (!EnsureTorsoProfile()) return -1f;
            BuildTorsoGrid();
            if (p.y < _torsoBaseY || p.y > _torsoNeckAt.y) return -1f;
            return TorsoSurface(p, out float distance) - (distance - radius);
        }

        private float TorsoSurface(Vector3 p, out float distance)
        {
            Vector3 axis = TorsoAxis(p.y);
            float dx = p.x - axis.x, dz = p.z - axis.z;
            distance = Mathf.Sqrt(dx * dx + dz * dz);
            if (distance < 1e-4f) return 1f;
            // Поверхность в направлении точки: соседние срезы (±2 см) и сектора (±10°).
            int slice = Mathf.FloorToInt((p.y - _torsoBaseY) / TorsoSlice);
            int sector = Sector(dx, dz);
            float surface = 0f;
            for (int s = slice - 1; s <= slice + 1; s++)
            {
                if (s < 0 || s >= _torsoSlices) continue;
                for (int k = -1; k <= 1; k++)
                {
                    float r = _torsoGrid[s * TorsoSectors + (sector + k + TorsoSectors) % TorsoSectors];
                    // Соседний сектор смотрит мимо на 10°: его радиус — по cos.
                    if (k != 0) r *= 0.985f;
                    if (r > surface) surface = r;
                }
            }
            return surface;
        }

        private float ArmDepth(Transform shoulder, Transform elbow, Transform hand, float fromForearm = -1f)
        {
            BuildTorsoGrid();
            Vector3 hips = _torsoHipsAt, neck = _torsoNeckAt;
            float worst = -1f;
            for (int seg = 0; seg < 2; seg++)
            {
                Vector3 a = seg == 0 ? shoulder.position : elbow.position, b = seg == 0 ? elbow.position : hand.position;
                if (fromForearm >= 0f && seg == 0) continue;
                for (float t = seg == 0 ? 0.6f : Mathf.Max(0f, fromForearm); t <= (seg == 0 ? 1.001f : fromForearm >= 0f ? 1.001f : 0.801f); t += 0.1f)
                {
                    Vector3 p = Vector3.Lerp(a, b, t);
                    if (p.y < _torsoBaseY || p.y > neck.y) continue;
                    float surface = TorsoSurface(p, out float distance);
                    if (distance < 1e-4f) return 0.3f;
                    worst = Mathf.Max(worst, surface - (distance - ArmRadius));
                }
            }
            return worst;
        }

        private static void LimitSwing(RoaHandGrip grip, bool left, float maxShoulderDeg, float maxElbowDeg,
            Vector3 forward, Vector3 right, float minElbowDeg = 0f, float minSideDeg = 1f)
        {
            Transform hand = grip.Hand;
            Transform elbow = hand.parent;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return;
            Vector3 outward = left ? -right : right;

            // Плечо: доля «вперёд» у направления плеча — не больше sin(max).
            Vector3 upper = elbow.position - shoulder.position;
            Vector3 dir = upper.normalized;
            float along = Vector3.Dot(dir, forward);
            float limit = Mathf.Sin(maxShoulderDeg * Mathf.Deg2Rad);
            // Только опущенная рука: поднятую (жест, клип действия) кап не трогает.
            if (along > limit && dir.y < 0.3f)
            {
                Vector3 rest = dir - forward * along;
                float restLength = rest.magnitude;
                if (restLength > 1e-4f)
                {
                    Vector3 wanted = forward * limit + rest / restLength * Mathf.Sqrt(1f - limit * limit);
                    shoulder.rotation = Quaternion.FromToRotation(dir, wanted) * shoulder.rotation;
                }
            }

            // Плечо в стороне: не дальше 25° наружу («крыло») и не внутрь за линию
            // плеча — кисти не сходятся перед пахом.
            dir = (elbow.position - shoulder.position).normalized;
            float side = Vector3.Dot(dir, outward);
            float sideLimit = Mathf.Sin(25f * Mathf.Deg2Rad);
            // В приседе плечо отведено сильнее: кисти ложатся снаружи колен, а не в бёдра.
            float clampedSide = Mathf.Clamp(side, Mathf.Sin(minSideDeg * Mathf.Deg2Rad), sideLimit);
            if (!Mathf.Approximately(side, clampedSide) && dir.y < 0.3f)
            {
                Vector3 rest = dir - outward * side;
                float restLength = rest.magnitude;
                if (restLength > 1e-4f)
                {
                    Vector3 wanted = outward * clampedSide + rest / restLength * Mathf.Sqrt(1f - clampedSide * clampedSide);
                    shoulder.rotation = Quaternion.FromToRotation(dir, wanted) * shoulder.rotation;
                }
            }

            // Локоть: сгиб не больше maxElbow; в приседе — не меньше minElbow (кисти к
            // бёдрам, а не плетьми до колен).
            upper = (elbow.position - shoulder.position).normalized;
            Vector3 lower = hand.position - elbow.position;
            float bend = Vector3.Angle(upper, lower);
            if (bend > maxElbowDeg)
            {
                Vector3 wanted = Vector3.Slerp(upper, lower.normalized, maxElbowDeg / bend);
                elbow.rotation = Quaternion.FromToRotation(lower, wanted) * elbow.rotation;
            }
            else if (bend < minElbowDeg)
            {
                Vector3 flexAxis = Vector3.Cross(upper, forward);
                if (flexAxis.sqrMagnitude > 1e-6f)
                    elbow.rotation = Quaternion.AngleAxis(minElbowDeg - bend, flexAxis.normalized) * elbow.rotation;
            }

            // Кисть — снаружи линии плеча (на 5 см), руки не сходятся к паху.
            Vector3 fromShoulder = hand.position - shoulder.position;
            float handOut = Vector3.Dot(fromShoulder, outward);
            if (handOut < 0.05f)
            {
                float length = fromShoulder.magnitude;
                Vector3 swingAxis = Vector3.Cross(fromShoulder, outward);
                if (length > 0.1f && swingAxis.sqrMagnitude > 1e-6f)
                {
                    float angle = Mathf.Asin(Mathf.Clamp((0.05f - handOut) / length, 0f, 0.5f)) * Mathf.Rad2Deg;
                    shoulder.rotation = Quaternion.AngleAxis(angle, swingAxis.normalized) * shoulder.rotation;
                }
            }

            // Ладонь к бедру: тыл кисти — наружу и немного вперёд. Поворот вокруг
            // предплечья делят предплечье и кисть: у тела нет костей скрутки.
            grip.HeldFrame(0.03f, out _, out _, out Vector3 back);
            Vector3 axis = (hand.position - elbow.position).normalized;
            Vector3 have = Vector3.ProjectOnPlane(back, axis);
            Vector3 want = Vector3.ProjectOnPlane(outward + forward * 0.35f, axis);
            if (have.sqrMagnitude < 1e-6f || want.sqrMagnitude < 1e-6f) return;
            float roll = Vector3.SignedAngle(have, want, axis);
            Quaternion half = Quaternion.AngleAxis(roll * 0.5f, axis);
            elbow.rotation = half * elbow.rotation;
            hand.rotation = half * hand.rotation;
        }

        /// <summary>Приблизить плечо к отвесу (гасит мах руки при ходьбе на долю amount).</summary>
        /// <summary>
        /// Длинное древко (кирка, лопата): кисти дальше 40 см друг от друга — нижняя
        /// у бедра, и локоть ей нужен явно наружу, иначе он перескакивает к животу.
        /// </summary>
        private bool LongHaft()
        {
            RoaWeaponView weapon = _view != null ? _view.HeldWeapon : null;
            // Только в стойке: в ударе древко ведёт стойка удара, и отвод задирал локоть.
            return weapon != null && weapon.DebugAttackPhase < 0f && weapon.HoldRight.Active && weapon.HoldLeft.Active
                && (weapon.HoldRight.Centre - weapon.HoldLeft.Centre).sqrMagnitude > 0.16f;
        }

        /// <summary>
        /// Свободная рука (кейс, при щите) в объёмной броне: плечо отводится наружу
        /// шагами по 8 см, пока рука не выйдет из торса.
        /// </summary>
        private void ClearFreeArm(RoaHandGrip grip, float amount, Vector3 outward, float start = 0f)
        {
            Transform elbow = grip != null && grip.Ready ? grip.Hand.parent : null;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null || !EnsureTorsoProfile()) return;
            for (int step = 1; step <= 3 && Mathf.Max(ArmDepth(shoulder, elbow, grip.Hand),
                ArmDepth(shoulder, elbow, grip.Hand, 0.7f)) > ArmTouchDepth; step++)
                CalmArm(grip, amount, outward * (start + 0.08f * step));
        }

        private static float ElbowAngle(RoaHandGrip grip)
        {
            if (grip == null || !grip.Ready) return 180f;
            Transform elbow = grip.Hand.parent;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return 180f;
            return Vector3.Angle(shoulder.position - elbow.position, grip.Hand.position - elbow.position);
        }

        private static void CalmArm(RoaHandGrip grip, float amount, Vector3 outward = default)
        {
            if (grip == null || !grip.Ready) return;
            Transform elbow = grip.Hand.parent;
            Transform shoulder = elbow != null ? elbow.parent : null;
            if (shoulder == null) return;
            Vector3 upper = elbow.position - shoulder.position;
            Vector3 calmer = Vector3.Slerp(upper.normalized, (Vector3.down + outward).normalized, amount);
            shoulder.rotation = Quaternion.FromToRotation(upper, calmer) * shoulder.rotation;
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
            _armorLayer = null;
            _armorGarment = _armorGarmentFull = null;
            foreach (GameObject part in _armorParts)
            {
                if (part == null) continue;
                part.SetActive(false);
                if (Application.isPlaying) Destroy(part);
                else DestroyImmediate(part);
            }
            _armorParts.Clear();
            _hingedParts.Clear();
            _bodyRenderer.sharedMesh = _originalBodyMesh;
            _armorId = null;
            if (string.IsNullOrEmpty(itemId)) return;

            string body = _female ? "female_medium" : "male_medium";
            Mesh faceAndHands = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/base_" + body);
            Mesh garment = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/" + itemId + "_" + body);
            // Worn without boots the outfit keeps its own shins and shoes.
            Mesh garmentFull = Resources.Load<Mesh>("RealmOfAshes/ArmorLayers/" + itemId + "_full_" + body);
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
            _armorLayer = layer;
            _armorGarment = garment;
            _armorGarmentFull = garmentFull;
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
                if (itemId == "heavyArmor" && part.name.Contains("Shoulder_Sports")) continue;
                AttachArmorPart(part.gameObject, part.transform.parent?.name, targetBones);
            }
            if (itemId == "heavyArmor" || itemId == "metalArmor" || itemId == "combatArmor")
            {
                // A matching pair of the pack's metal shoulder plates; the female
                // donor outfits have none, and the soldier wears only the right one.
                AddDonorPart(RoaApocalypseWornParts.PlateDonor, "Armour_Shoulder_Metal_L", targetBones);
                if (itemId != "combatArmor" || _female)
                    AddDonorPart(RoaApocalypseModels.CharacterOutfit(false, "combatArmor"),
                        "Armour_Shoulder_Metal_R", targetBones);
            }
            if (itemId == "heavyArmor" || itemId == "metalArmor")
            {
                AttachWornPart(MetalWristL, targetBones, _armorParts);
                AttachWornPart(MetalWristR, targetBones, _armorParts);
            }
            if (itemId == "metalArmor")
            {
                // «Лом» is scrap plate strapped over work clothes: metal on every joint.
                AddDonorPart(RoaApocalypseModels.CharacterOutfit(false, "combatArmor"),
                    "Armour_Thigh_Metal_L", targetBones);
                AttachWornPart(MetalKneeL, targetBones, _armorParts);
                AttachWornPart(MetalKneeR, targetBones, _armorParts);
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
            // Pack shoulder plates hang on the clavicle, which the retargeted idle
            // shrugs by ~25°. Rigid on the arm they stand up like fins, rigid on
            // the chest they float off the lowered shoulder: hinge them between.
            string armBone = null;
            if (source != null && source.name.Contains("Armour_Shoulder") && boneName != null
                && boneName.StartsWith("Clavicle_", System.StringComparison.Ordinal))
            {
                armBone = "Shoulder_" + boneName.Substring("Clavicle_".Length);
                boneName = "Spine_03";
            }
            if (source == null || boneName == null || !targetBones.TryGetValue(boneName, out Transform bone)) return;
            GameObject part = Instantiate(source, bone, false);
            // Keep the part where the donor wears it relative to the (possibly
            // re-chosen) bone, so it follows that bone like the garment does.
            if (DonorBonePlacement(source, boneName, out Matrix4x4 local))
            {
                part.transform.localPosition = local.GetColumn(3);
                part.transform.localRotation = local.rotation;
                part.transform.localScale = local.lossyScale;
            }
            part.name = "PolygonApocalypse_ArmorPart:" + source.name;
            PaintMetal(part);
            if (armBone != null && targetBones.TryGetValue(armBone, out Transform arm)
                && DonorBonePlacement(source, armBone, out Matrix4x4 onArm))
                _hingedParts.Add(new HingedPart
                    { Part = part.transform, Chest = bone, Arm = arm, OnChest = local, OnArm = onArm });
            foreach (Collider collider in part.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (Transform node in part.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = gameObject.layer;
            _armorParts.Add(part);
        }

        private void AttachWornPart(WornPart worn, Dictionary<string, Transform> targetBones, List<GameObject> into)
        {
            GameObject prefab = RoaApocalypseWornParts.Get(worn.Name);
            if (prefab == null || !targetBones.TryGetValue(worn.Bone, out Transform bone)) return;
            GameObject part = Instantiate(prefab, bone, false);
            part.transform.localPosition = worn.Position;
            part.transform.localRotation = Quaternion.Euler(worn.Euler);
            part.transform.localScale = Vector3.one;
            if (worn.OnBody && BodyPlacement(prefab, worn, out Matrix4x4 local))
            {
                part.transform.localPosition = local.GetColumn(3);
                part.transform.localRotation = local.rotation;
            }
            part.name = "PolygonApocalypse_WornPart:" + worn.Name;
            PaintMetal(part);
            foreach (Collider collider in part.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            foreach (Transform node in part.GetComponentsInChildren<Transform>(true)) node.gameObject.layer = gameObject.layer;
            into.Add(part);
        }

        /// <summary>
        /// Bone-local pose for a part placed on the standing pack body: its mesh
        /// centre at Position and turned by Euler, measured on the body prefab.
        /// </summary>
        private bool BodyPlacement(GameObject prefab, WornPart worn, out Matrix4x4 local)
        {
            local = Matrix4x4.identity;
            GameObject body = RoaApocalypseModels.Character(_female ? "female" : "male");
            MeshFilter filter = prefab.GetComponentInChildren<MeshFilter>(true);
            if (body == null || filter == null || filter.sharedMesh == null) return false;
            Transform bone = null;
            foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
                if (node.name == worn.Bone) { bone = node; break; }
            if (bone == null) return false;
            Matrix4x4 mesh = prefab.transform.worldToLocalMatrix * filter.transform.localToWorldMatrix;
            Vector3 centre = mesh.MultiplyPoint3x4(filter.sharedMesh.bounds.center);
            Matrix4x4 onBody = Matrix4x4.TRS(worn.Position, Quaternion.Euler(worn.Euler), Vector3.one)
                * Matrix4x4.Translate(-centre);
            local = bone.worldToLocalMatrix * body.transform.localToWorldMatrix * onBody;
            return true;
        }

        /// <summary>The default atlas paints pack plates rust-orange, close to skin; plates are dark metal.</summary>
        private static void PaintMetal(GameObject part, bool always = false)
        {
            Material metal = RoaApocalypseWornParts.Metal;
            if (metal == null || (!always && !part.name.Contains("_Metal_"))) return;
            foreach (Renderer renderer in part.GetComponentsInChildren<Renderer>(true))
            {
                var materials = new Material[renderer.sharedMaterials.Length];
                for (int i = 0; i < materials.Length; i++) materials[i] = metal;
                renderer.sharedMaterials = materials;
            }
        }

        private void RefreshHelmetLook(string helmetId)
        {
            string look = helmetId != null ? helmetId + "#" + _helmet.GetHashCode() : null;
            if (look == _helmetLook) return;
            _helmetLook = look;
            if (helmetId == null || System.Array.IndexOf(HeadBoneHelmets, helmetId) < 0) return;
            Transform head = FindVisualBone("Head");
            if (head == null) return;
            // Centring the hockey mask on the skull pushed it onto the crown and left
            // the face open; the gas mask would drag the helmet down the same way.
            _helmet.transform.SetParent(head, false);
            _helmet.transform.localPosition = Vector3.zero;
            _helmet.transform.localRotation = Quaternion.identity;
        }

        /// <summary>Artifact detector and belt: pack radio and pouches, rebuilt when either changes.</summary>
        private void RefreshUtilities()
        {
            if (_view == null || _visual == null) return;
            string detector = LoadedItem("detector", DetectorIds);
            string belt = LoadedItem("artifactBelt", BeltIds);
            string key = detector + "|" + belt;
            if (key == _utilityKey) return;
            _utilityKey = key;
            foreach (GameObject part in _utilityParts)
            {
                if (part == null) continue;
                part.SetActive(false);
                if (Application.isPlaying) Destroy(part);
                else DestroyImmediate(part);
            }
            _utilityParts.Clear();
            if (detector == null && belt == null) return;
            var targetBones = new Dictionary<string, Transform>();
            foreach (Transform node in _visual.GetComponentsInChildren<Transform>(true))
                if (!targetBones.ContainsKey(node.name)) targetBones.Add(node.name, node);
            if (detector == "artifactDetectorMk1") AttachWornPart(DetectorSmall, targetBones, _utilityParts);
            if (detector == "artifactDetectorMk2" || detector == "artifactDetectorMk3")
                AttachWornPart(DetectorLarge, targetBones, _utilityParts);
            if (detector == "artifactDetectorMk3") AttachWornPart(DetectorSecond, targetBones, _utilityParts);
            // artifactBelt2..4 carries two to four pouches.
            int pouches = belt != null ? belt[belt.Length - 1] - '0' : 0;
            for (int i = 0; i < pouches && i < BeltPouches.Length; i++)
                AttachWornPart(BeltPouches[i], targetBones, _utilityParts);
        }

        /// <summary>
        /// The metal «Лом» wears over its donor outfit, placed on a standing pack
        /// character (the item icon): shoulder plates, wrists, thigh and knees.
        /// </summary>
        public static void DressMetalArmorAtRest(GameObject character)
        {
            var bones = new Dictionary<string, Transform>();
            foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                if (!bones.ContainsKey(node.name)) bones.Add(node.name, node);
            void Donor(GameObject donor, string name)
            {
                if (donor == null) return;
                foreach (MeshRenderer source in donor.GetComponentsInChildren<MeshRenderer>(true))
                {
                    string bone = source.transform.parent?.name;
                    if (!source.enabled || !source.name.Contains(name) || bone == null
                        || !bones.TryGetValue(bone, out Transform target)
                        || !DonorBonePlacement(source.gameObject, bone, out Matrix4x4 local)) continue;
                    GameObject part = Instantiate(source.gameObject, target, false);
                    part.transform.localPosition = local.GetColumn(3);
                    part.transform.localRotation = local.rotation;
                    part.transform.localScale = local.lossyScale;
                    PaintMetal(part);
                }
            }
            Donor(RoaApocalypseWornParts.PlateDonor, "Armour_Shoulder_Metal_L");
            Donor(RoaApocalypseModels.CharacterOutfit(false, "combatArmor"), "Armour_Shoulder_Metal_R");
            Donor(RoaApocalypseModels.CharacterOutfit(false, "combatArmor"), "Armour_Thigh_Metal_L");
            foreach (WornPart worn in new[] { MetalWristL, MetalWristR, MetalKneeL, MetalKneeR })
            {
                GameObject prefab = RoaApocalypseWornParts.Get(worn.Name);
                if (prefab == null || !bones.TryGetValue(worn.Bone, out Transform bone)) continue;
                GameObject part = Instantiate(prefab, bone, false);
                part.transform.localPosition = worn.Position;
                part.transform.localRotation = Quaternion.Euler(worn.Euler);
                part.name = "PolygonApocalypse_WornPart:" + worn.Name;
                PaintMetal(part);
            }
        }

        private void FollowHingedParts()
        {
            foreach (HingedPart hinge in _hingedParts)
            {
                if (hinge.Part == null || hinge.Chest == null || hinge.Arm == null) continue;
                Matrix4x4 chest = hinge.Chest.localToWorldMatrix * hinge.OnChest;
                Matrix4x4 arm = hinge.Arm.localToWorldMatrix * hinge.OnArm;
                hinge.Part.SetPositionAndRotation(
                    Vector3.Lerp(chest.GetColumn(3), arm.GetColumn(3), 0.5f),
                    Quaternion.Slerp(chest.rotation, arm.rotation, 0.5f));
            }
        }

        private static bool DonorBonePlacement(GameObject source, string boneName, out Matrix4x4 local)
        {
            // The part sits on the donor's rest pose, which the skinned garment
            // shares; keep that offset from the named donor bone.
            local = Matrix4x4.identity;
            foreach (Transform bone in source.transform.root.GetComponentsInChildren<Transform>(true))
                if (bone.name == boneName)
                {
                    local = bone.worldToLocalMatrix * source.transform.localToWorldMatrix;
                    return true;
                }
            return false;
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
            RefreshHelmetLook(_helmet != null ? helmetId : null);
            RefreshFootwear();
            RefreshUtilities();
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
            bool fullGarment = _armorLayer != null && _armorGarmentFull != null && _footwearId == null;
            if (_armorLayer != null)
            {
                Mesh garment = fullGarment ? _armorGarmentFull : _armorGarment;
                if (_armorLayer.sharedMesh != garment)
                {
                    _armorLayer.sharedMesh = garment;
                    _armorLayer.localBounds = garment.bounds;
                }
            }
            string name = _armorId != null
                ? (_footwearId != null || fullGarment ? "base_no_feet_" : "base_") + body
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
            if (current == null) return;
            // The assault boots' knee and thigh plates are hazard-yellow in the atlas.
            if (prefab.name.Contains("_Metal_")) PaintMetal(current, true);
            _footwear.Add(current);
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
