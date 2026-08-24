using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Камера вида сверху, следующая за целью.
    ///
    /// Углы и дистанция подобраны под ту же читаемость сцены, что и у web-клиента:
    /// наклон около 55° даёт видеть и пол, и фасады строений.
    /// </summary>
    public sealed class RoaCameraRig : MonoBehaviour
    {
        private const string ZoomPrefsKey = "roa.cameraDistance.v2";

        public Transform Target;

        [Header("Расположение")]
        public float Distance = 14f;
        public float PitchDeg = 55f;
        public float YawDeg = 45f;

        [Header("Сглаживание")]
        [Tooltip("Время догона цели, сек. 0 — жёсткая привязка.")]
        public float SmoothTime = 0.12f;

        [Header("Зум колесом")]
        public float MinDistance = 8f;
        public float MaxDistance = 28f;
        public float ZoomSpeed = 6f;

        /// <summary>
        /// The global map has its own temporary zoom range. It disables saving so
        /// map zoom never overwrites the player's local-location camera distance.
        /// </summary>
        public bool ZoomPersistenceEnabled = true;

        private Vector3 _velocity;
        private float _impulse;

        private void Awake()
        {
            if (PlayerPrefs.HasKey(ZoomPrefsKey))
                Distance = Mathf.Clamp(PlayerPrefs.GetFloat(ZoomPrefsKey, Distance), MinDistance, MaxDistance);
        }

        private void LateUpdate()
        {
            if (Target == null) return;

            float scroll = RoaGameBootstrap.BlocksWorldHud ? 0f : Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.0001f)
                SetDistance(Distance - scroll * ZoomSpeed * Distance, ZoomPersistenceEnabled);

            Quaternion orbit = Quaternion.Euler(PitchDeg, YawDeg, 0f);
            Vector3 desired = Target.position - orbit * Vector3.forward * Distance;
            float impulse = _impulse;
            if (impulse > 0.001f)
            {
                float phase = Time.unscaledTime * 72f;
                desired += orbit * new Vector3(Mathf.Sin(phase) * impulse * 0.42f,
                                                Mathf.Cos(phase * 0.83f) * impulse * 0.28f,
                                                impulse * 0.48f);
                _impulse = Mathf.MoveTowards(_impulse, 0f, Time.unscaledDeltaTime * 0.9f);
            }

            transform.position = SmoothTime > 0f
                ? Vector3.SmoothDamp(transform.position, desired, ref _velocity, SmoothTime)
                : desired;

            transform.rotation = orbit * Quaternion.Euler(impulse * Mathf.Sin(Time.unscaledTime * 63f) * 7f, 0f, 0f);
        }

        public void AddImpulse(float amount)
        {
            if (RoaGameBootstrap.BlocksWorldHud) return;
            _impulse = Mathf.Clamp(Mathf.Max(_impulse, amount), 0f, 0.22f);
        }

        public void SetDistance(float distance, bool persist)
        {
            Distance = Mathf.Clamp(distance, MinDistance, MaxDistance);
            if (!persist) return;
            PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);
            PlayerPrefs.Save();
        }

        /// <summary>Мгновенно поставить камеру на место — при входе в локацию, без пролёта через всю карту.</summary>
        public void SnapToTarget()
        {
            if (Target == null) return;

            Quaternion orbit = Quaternion.Euler(PitchDeg, YawDeg, 0f);
            transform.position = Target.position - orbit * Vector3.forward * Distance;
            transform.rotation = orbit;
            _velocity = Vector3.zero;
            _impulse = 0f;
        }

        /// <summary>Направление «вперёд» для ввода: проекция взгляда камеры на горизонталь.</summary>
        public Vector3 PlanarForward()
        {
            Vector3 forward = transform.forward;
            forward.y = 0f;
            return forward.sqrMagnitude > 0.0001f ? forward.normalized : Vector3.forward;
        }

        public Vector3 PlanarRight()
        {
            Vector3 right = transform.right;
            right.y = 0f;
            return right.sqrMagnitude > 0.0001f ? right.normalized : Vector3.right;
        }
    }
}
