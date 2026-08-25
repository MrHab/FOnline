using UnityEngine;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaCameraRig
    {
        [Header("Живое кадрирование")]
        [Min(0f)] public float MovementLookAhead = 1.35f;
        [Min(0f)] public float CursorLookAhead = 1.65f;
        [Min(0.01f)] public float LookAheadSmoothTime = 0.2f;
        [Min(0.5f)] public float TeleportSnapDistance = 7.5f;
        [Min(0f)] public float MaximumFramingOffset = 2.35f;

        public Vector3 CurrentFramingOffset { get { return _framingOffset; } }
        public float TrackedTargetSpeed { get; private set; }

        private Transform _presentationTarget;
        private Vector3 _lastTargetPosition;
        private Vector3 _framingOffset;
        private Vector3 _framingVelocity;
        private bool _hasTargetPosition;

        private Vector3 UpdatePresentationTarget(
            Transform target, Quaternion orbit, out bool teleported)
        {
            teleported = false;
            if (target == null) return Vector3.zero;

            Vector3 targetPosition = target.position;
            if (_presentationTarget != target || !_hasTargetPosition)
            {
                _presentationTarget = target;
                _lastTargetPosition = targetPosition;
                _framingOffset = Vector3.zero;
                _framingVelocity = Vector3.zero;
                _hasTargetPosition = true;
                TrackedTargetSpeed = 0f;
                return targetPosition;
            }

            Vector3 delta = targetPosition - _lastTargetPosition;
            _lastTargetPosition = targetPosition;
            delta.y = 0f;
            float deltaTime = Mathf.Max(0.001f, Time.unscaledDeltaTime);
            teleported = ShouldSnapForTargetDelta(delta, TeleportSnapDistance);
            if (teleported)
            {
                _framingOffset = Vector3.zero;
                _framingVelocity = Vector3.zero;
                TrackedTargetSpeed = 0f;
                return targetPosition;
            }

            TrackedTargetSpeed = delta.magnitude / deltaTime;
            bool localGameplay = ZoomPersistenceEnabled && !RoaGameBootstrap.BlocksWorldHud;
            Vector3 wanted = Vector3.zero;
            if (localGameplay)
            {
                wanted += CalculateMovementLookAhead(
                    delta / deltaTime, MovementLookAhead, 0.35f, 4.4f);

                if (!Application.isMobilePlatform && Input.mousePresent
                    && Screen.width > 0 && Screen.height > 0)
                {
                    Vector2 normalizedCursor = new Vector2(
                        Input.mousePosition.x / Screen.width * 2f - 1f,
                        Input.mousePosition.y / Screen.height * 2f - 1f);
                    Vector3 forward = orbit * Vector3.forward;
                    Vector3 right = orbit * Vector3.right;
                    forward.y = 0f;
                    right.y = 0f;
                    if (forward.sqrMagnitude > 0.001f) forward.Normalize();
                    if (right.sqrMagnitude > 0.001f) right.Normalize();
                    wanted += CalculateCursorLookAhead(
                        normalizedCursor, right, forward, CursorLookAhead, 0.2f);
                }
            }

            wanted = Vector3.ClampMagnitude(wanted, Mathf.Max(0f, MaximumFramingOffset));
            _framingOffset = Vector3.SmoothDamp(
                _framingOffset, wanted, ref _framingVelocity,
                Mathf.Max(0.01f, LookAheadSmoothTime), 12f, deltaTime);
            return targetPosition + _framingOffset;
        }

        private void ResetPresentationState(Vector3 targetPosition)
        {
            _presentationTarget = Target;
            _lastTargetPosition = targetPosition;
            _framingOffset = Vector3.zero;
            _framingVelocity = Vector3.zero;
            _hasTargetPosition = Target != null;
            TrackedTargetSpeed = 0f;
        }

        public static Vector3 CalculateMovementLookAhead(
            Vector3 planarVelocity, float distance, float deadSpeed, float fullSpeed)
        {
            planarVelocity.y = 0f;
            float speed = planarVelocity.magnitude;
            if (speed <= Mathf.Max(0f, deadSpeed) || distance <= 0f) return Vector3.zero;
            float amount = Mathf.InverseLerp(
                Mathf.Max(0f, deadSpeed), Mathf.Max(deadSpeed + 0.01f, fullSpeed), speed);
            return planarVelocity.normalized * Mathf.Max(0f, distance) * amount;
        }

        public static bool ShouldSnapForTargetDelta(Vector3 delta, float threshold)
        {
            delta.y = 0f;
            return delta.magnitude >= Mathf.Max(0.5f, threshold);
        }

        public static Vector3 CalculateCursorLookAhead(
            Vector2 normalizedCursor, Vector3 planarRight, Vector3 planarForward,
            float distance, float deadZone)
        {
            float magnitude = Mathf.Clamp01(normalizedCursor.magnitude);
            deadZone = Mathf.Clamp(deadZone, 0f, 0.95f);
            if (magnitude <= deadZone || distance <= 0f) return Vector3.zero;

            Vector2 direction = normalizedCursor.normalized;
            float strength = Mathf.InverseLerp(deadZone, 1f, magnitude);
            planarRight.y = 0f;
            planarForward.y = 0f;
            if (planarRight.sqrMagnitude > 0.001f) planarRight.Normalize();
            if (planarForward.sqrMagnitude > 0.001f) planarForward.Normalize();
            Vector3 world = planarRight * direction.x + planarForward * direction.y;
            return world.sqrMagnitude > 0.001f
                ? world.normalized * Mathf.Max(0f, distance) * strength
                : Vector3.zero;
        }

        private static Vector3 EvaluateShakeOffset(
            Quaternion orbit, float impulse, float time)
        {
            float strength = Mathf.Clamp01(impulse / 0.22f);
            strength *= strength;
            float x = Mathf.Sin(time * 71f + 0.7f) * 0.62f
                + Mathf.Sin(time * 43f + 2.1f) * 0.38f;
            float y = Mathf.Sin(time * 59f + 1.3f) * 0.58f
                + Mathf.Sin(time * 37f + 3.6f) * 0.42f;
            float z = Mathf.Sin(time * 47f + 2.8f);
            return orbit * new Vector3(x * 0.085f, y * 0.065f, z * 0.045f)
                * strength;
        }

        private static Quaternion EvaluateShakeRotation(float impulse, float time)
        {
            float strength = Mathf.Clamp01(impulse / 0.22f);
            strength *= strength;
            float pitch = Mathf.Sin(time * 61f + 0.4f) * 0.72f * strength;
            float roll = Mathf.Sin(time * 53f + 1.9f) * 0.55f * strength;
            return Quaternion.Euler(pitch, 0f, roll);
        }
    }
}
