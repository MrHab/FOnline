using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Короткий направленный импульс поверх текущей анимации. Ноги продолжают
    /// локомоцию, а позвоночник и голова отклоняются от источника попадания.
    /// Оружейный IK применяется после этого слоя и сохраняет хват.
    /// </summary>
    public sealed class RoaHitReaction
    {
        public const float Duration = 0.42f;
        public const float ImpactSeconds = 0.06f;

        public struct PoseSample
        {
            public Vector3 Spine01;
            public Vector3 Spine02;
            public Vector3 Spine03;
            public Vector3 Neck;
            public Vector3 Head;
        }

        private Transform _spine01;
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
            PoseSample pose = Sample(_localSource, CurrentWeight);
            AddOffset(_spine01, pose.Spine01);
            AddOffset(_spine02, pose.Spine02);
            AddOffset(_spine03, pose.Spine03);
            AddOffset(_neck, pose.Neck);
            AddOffset(_head, pose.Head);
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
            float release = 1f - Smooth01((elapsed - ImpactSeconds) / (Duration - ImpactSeconds));
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
                Spine01 = new Vector3(pitch * 0.055f, twist * 0.025f, roll * 0.035f) * w,
                Spine02 = new Vector3(pitch * 0.070f, twist * 0.040f, roll * 0.050f) * w,
                Spine03 = new Vector3(pitch * 0.055f, twist * 0.045f, roll * 0.055f) * w,
                Neck = new Vector3(-pitch * 0.014f, twist * 0.012f, roll * 0.018f) * w,
                Head = new Vector3(-pitch * 0.032f, -twist * 0.018f, roll * 0.035f) * w
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
