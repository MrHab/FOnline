using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Камера вида сверху, следующая за целью.
    ///
    /// Углы и дистанция подобраны под ту же читаемость сцены, что и у web-клиента:
    /// наклон около 55° даёт видеть и пол, и фасады строений.
    /// </summary>
    public sealed partial class RoaCameraRig : MonoBehaviour
    {
        private const string ZoomPrefsKey = "roa.cameraDistance.v3";
        private const string LegacyZoomPrefsKey = "roa.cameraDistance.v2";

        public const float DefaultGameplayDistance = 13.5f;
        public const float MinimumGameplayDistance = 8f;
        public const float MaximumGameplayDistance = 21.5f;
        public const float GameplayFieldOfView = 52f;
        public const float StrategicFieldOfView = 60f;

        public Transform Target;

        [Header("Расположение")]
        public float Distance = DefaultGameplayDistance;
        public float PitchDeg = 55f;
        public float YawDeg = 45f;

        [Header("Сглаживание")]
        [Tooltip("Время догона цели, сек. 0 — жёсткая привязка.")]
        public float SmoothTime = 0.12f;

        [Header("Зум колесом")]
        public float MinDistance = MinimumGameplayDistance;
        public float MaxDistance = MaximumGameplayDistance;
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
            string key = PlayerPrefs.HasKey(ZoomPrefsKey) ? ZoomPrefsKey
                : PlayerPrefs.HasKey(LegacyZoomPrefsKey) ? LegacyZoomPrefsKey : string.Empty;
            if (!string.IsNullOrEmpty(key))
            {
                Distance = Mathf.Clamp(PlayerPrefs.GetFloat(key, Distance), MinDistance, MaxDistance);
                if (key == LegacyZoomPrefsKey)
                {
                    PlayerPrefs.SetFloat(ZoomPrefsKey, Distance);
                    PlayerPrefs.Save();
                }
            }
            SetFieldOfView(GameplayFieldOfView);
        }

        private void LateUpdate()
        {
            if (Target == null) return;

            float scroll = RoaGameBootstrap.BlocksWorldHud ? 0f : Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.0001f)
                SetDistance(Distance - scroll * ZoomSpeed * Distance, ZoomPersistenceEnabled);

            Quaternion orbit = Quaternion.Euler(PitchDeg, YawDeg, 0f);
            bool teleported;
            Vector3 framedTarget = UpdatePresentationTarget(Target, orbit, out teleported);
            Vector3 desired = framedTarget - orbit * Vector3.forward * Distance;
            float impulse = _impulse;
            if (impulse > 0.001f)
            {
                desired += EvaluateShakeOffset(orbit, impulse, Time.unscaledTime);
                _impulse = Mathf.MoveTowards(_impulse, 0f, Time.unscaledDeltaTime * 1.15f);
            }

            transform.position = teleported ? desired : SmoothTime > 0f
                ? Vector3.SmoothDamp(transform.position, desired, ref _velocity,
                    SmoothTime, Mathf.Infinity, Time.unscaledDeltaTime)
                : desired;
            if (teleported) _velocity = Vector3.zero;

            transform.rotation = orbit * EvaluateShakeRotation(impulse, Time.unscaledTime);
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

        public float CurrentFieldOfView
        {
            get
            {
                Camera view = GetComponent<Camera>();
                return view != null ? view.fieldOfView : GameplayFieldOfView;
            }
        }

        public void SetFieldOfView(float fieldOfView)
        {
            Camera view = GetComponent<Camera>();
            if (view != null) view.fieldOfView = Mathf.Clamp(fieldOfView, 35f, 75f);
        }

        public static float ProjectedActorScreenFraction(float actorHeight, float distance,
                                                          float fieldOfView, float pitchDeg)
        {
            float visibleHeight = Mathf.Max(0f, actorHeight)
                * Mathf.Abs(Mathf.Cos(pitchDeg * Mathf.Deg2Rad));
            float frustumHeight = 2f * Mathf.Max(0.01f, distance)
                * Mathf.Tan(Mathf.Clamp(fieldOfView, 1f, 179f) * 0.5f * Mathf.Deg2Rad);
            return visibleHeight / Mathf.Max(0.001f, frustumHeight);
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
            ResetPresentationState(Target.position);
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
