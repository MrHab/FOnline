using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Видимое оружие в левой руке. Сервер уже считает обе руки раздельно;
    /// этот слой зеркалит утверждённую позу правой кисти, решает левую руку IK
    /// и даёт второму стволу собственное дуло, упор в стену и жест перезарядки.
    /// </summary>
    public sealed class RoaOffhandWeaponView
    {
        private static readonly HashSet<string> Supported = new HashSet<string>
        {
            "pistol", "laserPistol"
        };

        private static readonly Vector3 MirroredSocketOffset = new Vector3(-0.03f, -0.02f, 0.025f);
        private const float AimLimit = 0.35f;
        private const float MinBarrelLength = 0.05f;
        private const float MinAimDistance = 0.35f;
        private const float ObstructionDistance = 0.95f;
        private const float ObstructionRadius = 0.18f;
        private const float ReadyRaiseAngle = 1.05f;

        private const float DefaultReloadSeconds = 0.82f;

        private Transform _characterRoot;
        private Transform _owner;
        private Transform _weapon;
        private Transform _socketGrip;
        private Transform _socketMuzzle;
        private Transform _leftHand;
        private Transform _rightHand;
        private RoaIkChain _leftArm;
        private Dictionary<string, Transform> _bones;
        private int _loadRequest;
        private float _obstructedBlend;
        private float _contactBumpStartedAt = -100f;
        private float _reloadStartedAt = -1f;
        private float _reloadDuration = DefaultReloadSeconds;

        public string WeaponId { get; private set; }
        public bool Ready { get; private set; }
        public bool ArmSolved { get; private set; }
        public float ObstructedBlend { get { return _obstructedBlend; } }
        public float ReloadBlend { get { return ReloadEnvelope(); } }
        public float ContactBumpWeight
        {
            get { return RoaWeaponView.ContactBumpEnvelope(Time.time - _contactBumpStartedAt); }
        }

        public void PlayBlockedContact()
        {
            _contactBumpStartedAt = Time.time;
        }

        public static bool IsSupported(string weaponId)
        {
            return !string.IsNullOrEmpty(weaponId) && Supported.Contains(weaponId);
        }

        public bool TryGetMuzzle(out Vector3 worldPosition)
        {
            if (_socketMuzzle != null)
            {
                worldPosition = _socketMuzzle.position;
                return true;
            }
            worldPosition = Vector3.zero;
            return false;
        }

        public void StartReload(float durationSeconds)
        {
            _reloadDuration = Mathf.Max(0.5f,
                durationSeconds > 0f ? durationSeconds : DefaultReloadSeconds);
            _reloadStartedAt = Time.time;
        }

        public void CancelReload()
        {
            _reloadStartedAt = -1f;
        }

        public void Unequip()
        {
            _loadRequest++;
            Clear();
        }

        public async Task Load(string baseUrl, string weaponId, Transform characterRoot,
                               Dictionary<string, Transform> bones)
        {
            weaponId = IsSupported(weaponId) ? weaponId : string.Empty;
            if (WeaponId == weaponId && (string.IsNullOrEmpty(weaponId) || Ready)) return;

            int request = ++_loadRequest;
            Clear();
            if (string.IsNullOrEmpty(weaponId) || characterRoot == null || bones == null) return;

            _characterRoot = characterRoot;
            _owner = characterRoot.root;
            _bones = bones;
            bones.TryGetValue("hand_l", out _leftHand);
            bones.TryGetValue("hand_r", out _rightHand);
            if (_leftHand == null || _rightHand == null)
            {
                Debug.LogWarning("[ROA] Нет кистей для оружия во второй руке.");
                return;
            }

            await RoaWeaponGrip.Ensure(baseUrl);
            if (request != _loadRequest || !RoaWeaponGrip.Ready) return;

            string url = baseUrl.TrimEnd('/') + "/assets/models/weapons/weapon_" + weaponId + ".glb";
            GltfImport import = await RoaWeaponView.LoadCached(weaponId, url);
            if (request != _loadRequest) return;
            if (import == null)
            {
                WeaponId = weaponId;
                Debug.LogError("[ROA] Модель оружия второй руки не загрузилась: " + url);
                return;
            }

            var holder = new GameObject("OffhandWeapon:" + weaponId);
            holder.transform.SetParent(characterRoot, false);
            if (!await import.InstantiateMainSceneAsync(holder.transform))
            {
                Object.Destroy(holder);
                return;
            }
            if (request != _loadRequest || characterRoot == null)
            {
                Object.Destroy(holder);
                return;
            }

            _weapon = holder.transform;
            _socketGrip = FindDeep(_weapon, "socket_grip_r");
            _socketMuzzle = FindDeep(_weapon, "socket_muzzle");
            if (_socketGrip == null || _socketMuzzle == null)
            {
                Debug.LogError("[ROA] У оружия второй руки " + weaponId + " нет сокетов хвата или дула.");
                WeaponId = weaponId;
                Object.Destroy(holder);
                _weapon = null;
                return;
            }

            _leftArm = new RoaIkChain(new[]
            {
                Bone("clavicle_l"), Bone("upperarm_l"), Bone("lowerarm_l"), _leftHand
            }, 12, 0.001f);

            WeaponId = weaponId;
            Ready = _leftArm.Ready;
            Debug.Log("[ROA] Оружие второй руки " + weaponId + " подключено.");
        }

        /// <summary>Дешёвый дальний LOD без решения цепи левой руки.</summary>
        public void ApplyReduced()
        {
            if (!Ready || _weapon == null || _leftHand == null) return;
            Mount();
        }

        public void Apply(Vector3 aimPoint, bool hasAim)
        {
            if (!Ready || _weapon == null || _characterRoot == null) return;

            RoaWeaponGrip.ApplyFingersTo(_bones);
            Matrix4x4 targetHandWorld = MirroredRightHandPose();
            ArmSolved = _leftArm.Solve(targetHandWorld.GetColumn(3), targetHandWorld.rotation, ArmPole());

            Mount();
            UpdateObstruction();
            if (hasAim) ConvergeToAim(aimPoint);
            ApplyReadyRaise();
        }

        /// <summary>Зеркалит жёсткую позу через локальную плоскость X=0.</summary>
        public static Matrix4x4 MirrorRigid(Matrix4x4 source)
        {
            Matrix4x4 mirror = Matrix4x4.Scale(new Vector3(-1f, 1f, 1f));
            Matrix4x4 mirrored = mirror * source * mirror;
            return Matrix4x4.TRS(mirrored.GetColumn(3), mirrored.rotation, Vector3.one);
        }

        private Matrix4x4 MirroredRightHandPose()
        {
            Matrix4x4 rightLocal = _characterRoot.worldToLocalMatrix * _rightHand.localToWorldMatrix;
            Matrix4x4 mirrored = MirrorRigid(rightLocal);

            float reload = ReloadEnvelope();
            Vector3 position = mirrored.GetColumn(3);
            Quaternion rotation = mirrored.rotation;
            if (reload > 0f)
            {
                position += new Vector3(0.10f, -0.14f, -0.09f) * reload;
                rotation *= Quaternion.Euler(18f * reload, -14f * reload, 22f * reload);
            }

            return _characterRoot.localToWorldMatrix
                * Matrix4x4.TRS(position, rotation, Vector3.one);
        }

        private void Mount()
        {
            Matrix4x4 handToMount = MirrorRigid(RoaWeaponGrip.HandToMount);
            Matrix4x4 targetWorld = _leftHand.localToWorldMatrix * handToMount
                * Matrix4x4.Translate(MirroredSocketOffset);
            Matrix4x4 socketLocal = _weapon.worldToLocalMatrix * _socketGrip.localToWorldMatrix;
            Matrix4x4 socketRigid = Matrix4x4.TRS(socketLocal.GetColumn(3), socketLocal.rotation, Vector3.one);
            Matrix4x4 weaponWorld = targetWorld * socketRigid.inverse;
            _weapon.SetPositionAndRotation(weaponWorld.GetColumn(3), weaponWorld.rotation);
        }

        private void UpdateObstruction()
        {
            float target = 0f;
            Vector3 grip = _socketGrip.position;
            Vector3 barrel = _socketMuzzle.position - grip;
            barrel.y = 0f;
            if (barrel.magnitude > MinBarrelLength)
            {
                Vector3 direction = barrel.normalized;
                Vector3 start = grip + direction * 0.08f;
                Vector3 end = grip + direction * ObstructionDistance;
                target = RoaWeaponView.ObstructionAmount(
                    start, end, ObstructionRadius, _owner, _weapon);
            }
            _obstructedBlend = RoaWeaponView.SmoothObstruction(
                _obstructedBlend, target, Time.deltaTime);
        }

        private void ConvergeToAim(Vector3 aim)
        {
            Vector3 pivot = _socketGrip.position;
            Vector3 tip = _socketMuzzle.position;
            Vector2 barrel = new Vector2(tip.x - pivot.x, tip.z - pivot.z);
            Vector2 target = new Vector2(aim.x - pivot.x, aim.z - pivot.z);
            if (barrel.magnitude < MinBarrelLength || target.magnitude < MinAimDistance) return;

            float delta = Mathf.Atan2(target.x, target.y) - Mathf.Atan2(barrel.x, barrel.y);
            delta = Mathf.Atan2(Mathf.Sin(delta), Mathf.Cos(delta));
            delta = Mathf.Clamp(delta, -AimLimit, AimLimit) * (1f - Mathf.Clamp01(_obstructedBlend));
            if (Mathf.Abs(delta) >= 0.0005f)
                _weapon.RotateAround(pivot, Vector3.up, delta * Mathf.Rad2Deg);
        }

        private void ApplyReadyRaise()
        {
            float contactBump = ContactBumpWeight;
            if (_obstructedBlend <= 0.01f && contactBump <= 0.001f) return;
            Vector3 pivot = _socketGrip.position;
            Vector3 barrel = _socketMuzzle.position - pivot;
            barrel.y = 0f;
            if (barrel.sqrMagnitude < 0.002f) return;
            Vector3 axis = Vector3.Cross(barrel.normalized, Vector3.up).normalized;
            float angle = _obstructedBlend * ReadyRaiseAngle + contactBump * 0.13f;
            _weapon.RotateAround(pivot, axis, angle * Mathf.Rad2Deg);
        }

        private float ReloadEnvelope()
        {
            if (_reloadStartedAt < 0f) return 0f;
            float phase = (Time.time - _reloadStartedAt) / _reloadDuration;
            if (phase < 0f || phase >= 1f) return 0f;
            return Mathf.Sin(phase * Mathf.PI);
        }

        private Vector3 ArmPole()
        {
            Transform upper = Bone("upperarm_l");
            Vector3 origin = upper != null ? upper.position : (_owner != null ? _owner.position : Vector3.zero);
            Vector3 right = _owner != null ? _owner.right : Vector3.right;
            Vector3 forward = _owner != null ? _owner.forward : Vector3.forward;
            return origin - right * 0.48f - forward * 0.18f + Vector3.down * 0.22f;
        }

        private Transform Bone(string name)
        {
            Transform bone;
            return _bones != null && _bones.TryGetValue(name, out bone) ? bone : null;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root == null) return null;
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                Transform found = FindDeep(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        private void Clear()
        {
            if (_weapon != null) Object.Destroy(_weapon.gameObject);
            _weapon = null;
            _socketGrip = null;
            _socketMuzzle = null;
            _leftArm = null;
            _leftHand = null;
            _rightHand = null;
            _characterRoot = null;
            _owner = null;
            WeaponId = string.Empty;
            Ready = false;
            ArmSolved = false;
            _obstructedBlend = 0f;
            _contactBumpStartedAt = -100f;
            _reloadStartedAt = -1f;
        }
    }
}
