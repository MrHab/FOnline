using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Короткий направленный импульс поверх текущей анимации. Ноги продолжают
    /// локомоцию (или стойку), таз сносит от источника попадания, позвоночник
    /// гнётся по всей цепи, а голова отстаёт, не запрокидываясь отдельно.
    /// Удар — за 0.07 с, 0.1 с в позе удара, возврат — к 0.6 с. Оружейный IK применяется после
    /// этого слоя и сохраняет хват.
    /// </summary>
    public sealed class RoaHitReaction
    {
        public const float Duration = 0.6f;
        public const float ImpactSeconds = 0.07f;
        // Удар держится в позе ещё немного, прежде чем тело выпрямляется.
        public const float HoldSeconds = 0.1f;
        // Снос таза от источника и просадка колен при полной силе, м.
        private const float PelvisPush = 0.07f;
        private const float PelvisDip = 0.03f;
        // Вздёрнутые плечи и подтянутые локти при полной силе, градусы.
        private const float ShrugDeg = 12f;
        private const float ElbowFlexDeg = 30f;

        public struct PoseSample
        {
            public Vector3 Spine01;
            public Vector3 Spine02;
            public Vector3 Spine03;
            public Vector3 Neck;
            public Vector3 Head;
        }

        private Transform _actor;
        private Transform _pelvis;
        private Transform _spine01;
        private readonly Transform[] _clavicles = new Transform[2];
        private readonly Transform[] _forearms = new Transform[2];
        private Transform _spine02;
        private Transform _spine03;
        private Transform _neck;
        private Transform _head;
        private float _elapsed = Duration;
        private float _strength;
        private Vector2 _localSource = Vector2.up;

        public bool Ready { get; private set; }
        public bool Active { get { return Ready && _elapsed < Duration; } }
        public Vector2 LocalSourceDirection { get { return _localSource; } }
        public float CurrentWeight
        {
            get { return Active ? Envelope(_elapsed) * _strength : 0f; }
        }

        public void Bind(Transform root)
        {
            Reset();
            Ready = false;
            if (root == null) return;
            _pelvis = FindDeep(root, "pelvis");
            _clavicles[0] = FindDeep(root, "clavicle_l");
            _clavicles[1] = FindDeep(root, "clavicle_r");
            _forearms[0] = FindDeep(root, "lowerarm_l");
            _forearms[1] = FindDeep(root, "lowerarm_r");
            _spine01 = FindDeep(root, "spine_01");
            _spine02 = FindDeep(root, "spine_02");
            _spine03 = FindDeep(root, "spine_03");
            _neck = FindDeep(root, "neck_01");
            _head = FindDeep(root, "head");
            Ready = _spine01 != null && _spine02 != null
                && _spine03 != null && _head != null;
        }

        public void Reset()
        {
            _elapsed = Duration;
            _strength = 0f;
            _localSource = Vector2.up;
        }

        public void Trigger(Transform actor, Vector3 sourceWorld, bool hasSource,
                            int damage, bool critical)
        {
            if (!Ready || actor == null) return;
            _actor = actor;
            Vector2 direction = Vector2.up;
            if (hasSource)
            {
                Vector3 delta = sourceWorld - actor.position;
                delta.y = 0f;
                if (delta.sqrMagnitude > 0.0144f)
                {
                    Vector3 local = actor.InverseTransformDirection(delta.normalized);
                    direction = new Vector2(local.x, local.z).normalized;
                }
            }

            float retained = CurrentWeight;
            if (Active)
            {
                Vector2 combined = Vector2.Lerp(_localSource, direction, 0.72f);
                _localSource = combined.sqrMagnitude > 0.001f ? combined.normalized : direction;
                _elapsed = Mathf.Min(_elapsed, ImpactSeconds * 0.42f);
            }
            else
            {
                _localSource = direction;
                _elapsed = 0f;
            }
            _strength = Mathf.Clamp(Mathf.Max(StrengthFor(damage, critical), retained), 0.6f, 1.42f);
        }

        public void Apply(float dt)
        {
            if (!Active) return;
            _elapsed = Mathf.Min(Duration, _elapsed + Mathf.Clamp(dt, 0f, 0.08f));
            if (!Active) return;
            float weight = CurrentWeight;
            PoseSample pose = Sample(_localSource, weight);
            if (_pelvis != null && _actor != null)
            {
                Vector3 away = _actor.TransformDirection(new Vector3(-_localSource.x, 0f, -_localSource.y));
                _pelvis.position += away * (PelvisPush * weight) + Vector3.down * (PelvisDip * weight);
            }
            if (_actor != null) Flinch(weight);
            AddOffset(_spine01, pose.Spine01);
            AddOffset(_spine02, pose.Spine02);
            AddOffset(_spine03, pose.Spine03);
            AddOffset(_neck, pose.Neck);
            AddOffset(_head, pose.Head);
        }

        /// <summary>
        /// Рефлекс: плечи вздёргиваются, локти подтягиваются к корпусу. Слой идёт до
        /// оружейного IK, поэтому хват на оружии остаётся точным.
        /// </summary>
        private void Flinch(float weight)
        {
            Vector3 up = _actor.up;
            Vector3 forward = _actor.forward;
            for (int i = 0; i < 2; i++)
            {
                // Сторона удара вздрагивает сильнее: руки не взлетают симметрично.
                float sideWeight = weight * Mathf.Clamp(1f + (i == 0 ? 0.7f : -0.7f) * -_localSource.x, 0.3f, 1.7f);
                // Предплечья лишь вздрагивают: сильнее — на стороне удара, но без «рук зомби».
                float elbowWeight = weight * Mathf.Clamp((i == 0 ? 1f : -1f) * -_localSource.x, 0f, 1f) * 0.5f;
                Transform clavicle = _clavicles[i];
                if (clavicle != null && clavicle.childCount > 0)
                {
                    Vector3 along = clavicle.GetChild(0).position - clavicle.position;
                    Vector3 axis = Vector3.Cross(along, up);
                    if (axis.sqrMagnitude > 1e-6f)
                        clavicle.rotation = Quaternion.AngleAxis(ShrugDeg * sideWeight, axis.normalized) * clavicle.rotation;
                }
                Transform forearm = _forearms[i];
                if (forearm != null && forearm.childCount > 0)
                {
                    Vector3 along = forearm.GetChild(0).position - forearm.position;
                    Vector3 axis = Vector3.Cross(along, forward);
                    if (axis.sqrMagnitude > 1e-6f)
                        forearm.rotation = Quaternion.AngleAxis(ElbowFlexDeg * elbowWeight, axis.normalized) * forearm.rotation;
                }
            }
        }

        public static float StrengthFor(int damage, bool critical)
        {
            float strength = Mathf.Lerp(0.72f, 1.12f, Mathf.InverseLerp(2f, 55f, damage));
            if (critical) strength *= 1.22f;
            return Mathf.Clamp(strength, 0.6f, 1.42f);
        }

        public static float Envelope(float elapsed)
        {
            if (elapsed <= 0f || elapsed >= Duration) return 0f;
            float attack = Smooth01(elapsed / ImpactSeconds);
            float release = 1f - Smooth01((elapsed - ImpactSeconds - HoldSeconds) / (Duration - ImpactSeconds - HoldSeconds));
            return Mathf.Clamp01(attack * release);
        }

        public static PoseSample Sample(Vector2 localSource, float weight)
        {
            if (localSource.sqrMagnitude < 0.001f) localSource = Vector2.up;
            else localSource.Normalize();
            float w = Mathf.Clamp(weight, 0f, 1.42f);
            float pitch = -localSource.y;
            float twist = -localSource.x;
            float roll = -localSource.x;
            return new PoseSample
            {
                // Удар ведёт корпус от поясницы; шея и голова отстают (чуть против
                // корпуса), лицо не задирается в небо.
                // Корпус ~20° от удара, шея и голова отстают: голова в мире не больше ~12°.
                Spine01 = new Vector3(pitch * 0.170f, twist * 0.120f, roll * 0.170f) * w,
                Spine02 = new Vector3(pitch * 0.130f, twist * 0.150f, roll * 0.180f) * w,
                Spine03 = new Vector3(pitch * 0.070f, twist * 0.130f, roll * 0.150f) * w,
                Neck = new Vector3(-pitch * 0.080f, twist * 0.020f, roll * 0.020f) * w,
                Head = new Vector3(-pitch * 0.070f, -twist * 0.025f, roll * 0.030f) * w
            };
        }

        private static float Smooth01(float value)
        {
            float t = Mathf.Clamp01(value);
            return t * t * (3f - 2f * t);
        }

        private static void AddOffset(Transform bone, Vector3 radians)
        {
            if (bone == null || radians.sqrMagnitude < 1e-8f) return;
            bone.localRotation = bone.localRotation * Quaternion.Euler(radians * Mathf.Rad2Deg);
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
    }
}
