using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Поза седока поверх клипа покоя: таз садится в седло, корпус подаётся к
    /// рулю, руки и ноги аналитическим IK из двух звеньев тянутся к точкам
    /// транспорта (grip_*, peg_*), пальцы обхватывают рукояти.
    ///
    /// Поворачиваются кости в мировом пространстве, поэтому поза не зависит от
    /// локальных осей рига и одинаково садится на все шесть тел. Вес позы
    /// смешивает её с клипом: при посадке и спешивании седок плавно переходит
    /// из стойки в седло и обратно.
    /// </summary>
    public sealed class RoaRiderPose
    {
        /// <summary>Сустав таза стоит над поверхностью седла.</summary>
        public const float PelvisAboveSeat = 0.09f;

        private const float WristBeforeGrip = 0.07f;
        private const float AnkleAbovePeg = 0.075f;

        private static readonly string[] FingerBones =
        {
            "index_01_l", "index_02_l", "index_03_l", "middle_01_l", "middle_02_l", "middle_03_l",
            "ring_01_l", "ring_02_l", "ring_03_l", "pinky_01_l", "pinky_02_l", "pinky_03_l",
            "thumb_01_l", "thumb_02_l", "thumb_03_l",
            "index_01_r", "index_02_r", "index_03_r", "middle_01_r", "middle_02_r", "middle_03_r",
            "ring_01_r", "ring_02_r", "ring_03_r", "pinky_01_r", "pinky_02_r", "pinky_03_r",
            "thumb_01_r", "thumb_02_r", "thumb_03_r"
        };

        private Transform _pelvis;
        private Transform _spine1;
        private Transform _spine2;
        private Transform _spine3;
        private Transform _head;
        private Transform _thighL, _calfL, _footL;
        private Transform _thighR, _calfR, _footR;
        private Transform _upperL, _lowerL, _handL;
        private Transform _upperR, _lowerR, _handR;
        private readonly List<Transform> _fingers = new List<Transform>();

        public bool Ready { get; private set; }

        /// <summary>Сколько не хватило руке или ноге до точки после решения, м. Для проб.</summary>
        public float LastReachError { get; private set; }

        public void Bind(Dictionary<string, Transform> bones)
        {
            Transform Bone(string name) => bones != null && bones.TryGetValue(name, out Transform bone) ? bone : null;
            _pelvis = Bone("pelvis");
            _spine1 = Bone("spine_01");
            _spine2 = Bone("spine_02");
            _spine3 = Bone("spine_03");
            _head = Bone("head");
            _thighL = Bone("thigh_l"); _calfL = Bone("calf_l"); _footL = Bone("foot_l");
            _thighR = Bone("thigh_r"); _calfR = Bone("calf_r"); _footR = Bone("foot_r");
            _upperL = Bone("upperarm_l"); _lowerL = Bone("lowerarm_l"); _handL = Bone("hand_l");
            _upperR = Bone("upperarm_r"); _lowerR = Bone("lowerarm_r"); _handR = Bone("hand_r");
            _fingers.Clear();
            foreach (string name in FingerBones)
            {
                Transform finger = Bone(name);
                if (finger != null) _fingers.Add(finger);
            }
            Ready = _pelvis != null && _thighL != null && _calfL != null && _footL != null
                && _thighR != null && _calfR != null && _footR != null
                && _upperL != null && _lowerL != null && _handL != null
                && _upperR != null && _lowerR != null && _handR != null;
        }

        /// <summary>
        /// Вызывать в LateUpdate, после того как клип записал кадр. weight 0..1,
        /// pace 0..1 — насколько быстро едем (корпус подаётся вперёд сильнее).
        /// bodyRoot — корень скелета: его сдвигает вызывающий обратно каждый кадр,
        /// поэтому посадка не копится, даже если клип не пишет положение таза.
        /// </summary>
        public void Apply(RoaVehicleView.Anchors anchors, float weight, float pace, Transform bodyRoot)
        {
            if (!Ready || weight <= 0.001f) return;
            weight = Mathf.Clamp01(weight);
            Vector3 up = anchors.Up;
            Vector3 forward = anchors.Forward;
            Vector3 right = anchors.Right;

            // 1. Таз в седло сдвигом всего скелета. Поворот таза остаётся от клипа:
            // он уже смотрит вдоль рамы.
            Vector3 seatTarget = anchors.Seat + up * PelvisAboveSeat - forward * 0.03f;
            Vector3 shift = (seatTarget - _pelvis.position) * weight;
            if (bodyRoot != null) bodyRoot.position += shift;
            else _pelvis.position += shift;

            // 2. Корпус к рулю, взгляд — на дорогу.
            float lean = Mathf.Lerp(9f, 17f, Mathf.Clamp01(pace)) * weight;
            Rotate(_spine1, right, lean * 0.5f);
            Rotate(_spine2, right, lean * 0.3f);
            Rotate(_spine3, right, lean * 0.2f);
            Rotate(_head, right, -lean * 0.6f);

            float reach = 0f;
            // 3. Ноги на подножки: колени вперёд и чуть наружу, к бакам.
            // Стопа сохраняет плоский поворот клипа, кисть идёт продолжением предплечья.
            reach = Mathf.Max(reach, Limb(_thighL, _calfL, _footL, anchors.PegLeft + up * AnkleAbovePeg - forward * 0.04f,
                forward * 0.7f - right * 0.3f + up * 0.25f, weight, true));
            reach = Mathf.Max(reach, Limb(_thighR, _calfR, _footR, anchors.PegRight + up * AnkleAbovePeg - forward * 0.04f,
                forward * 0.7f + right * 0.3f + up * 0.25f, weight, true));
            // 4. Руки на рукояти: локти наружу и вниз.
            reach = Mathf.Max(reach, Limb(_upperL, _lowerL, _handL, WristTarget(_upperL, anchors.GripLeft),
                -right * 0.55f - up * 0.35f - forward * 0.15f, weight, false));
            reach = Mathf.Max(reach, Limb(_upperR, _lowerR, _handR, WristTarget(_upperR, anchors.GripRight),
                right * 0.55f - up * 0.35f - forward * 0.15f, weight, false));
            LastReachError = reach;

            // 5. Пальцы обхватывают рукояти: берём сжатую кисть утверждённого хвата.
            if (RoaWeaponGrip.Ready && RoaWeaponGrip.Pose != null)
            {
                foreach (Transform finger in _fingers)
                {
                    if (finger == null || !RoaWeaponGrip.Pose.TryGetValue(finger.name, out RoaWeaponGrip.BonePose pose)) continue;
                    finger.localRotation = Quaternion.Slerp(finger.localRotation, pose.Rotation, weight);
                }
            }
        }

        /// <summary>Кисть садится чуть ближе к плечу, чем центр рукояти: ладонь её обхватывает.</summary>
        private static Vector3 WristTarget(Transform shoulder, Vector3 grip)
        {
            Vector3 back = shoulder.position - grip;
            return back.sqrMagnitude > 0.0001f ? grip + back.normalized * WristBeforeGrip : grip;
        }

        private static void Rotate(Transform bone, Vector3 axis, float degrees)
        {
            if (bone == null || Mathf.Abs(degrees) < 0.0001f) return;
            bone.rotation = Quaternion.AngleAxis(degrees, axis) * bone.rotation;
        }

        /// <summary>
        /// Аналитический IK из двух звеньев: сгиб по теореме косинусов, доворот
        /// цепи на цель и поворот плоскости сгиба к подсказке (колено, локоть).
        /// Возвращает, сколько не дотянулось. С keepEndRotation концевая кость
        /// сохраняет мировой поворот, который был до решения (стопа остаётся плоской).
        /// </summary>
        public static float Limb(Transform upper, Transform lower, Transform end, Vector3 target,
                                 Vector3 hintOffset, float weight, bool keepEndRotation)
        {
            Quaternion endRotation = end.rotation;
            Vector3 a = upper.position;
            Vector3 b = lower.position;
            Vector3 c = end.position;
            Vector3 t = Vector3.Lerp(c, target, weight);
            float ab = (b - a).magnitude;
            float bc = (c - b).magnitude;
            if (ab < 0.0001f || bc < 0.0001f) return 0f;
            float at = Mathf.Clamp((t - a).magnitude, 0.001f, (ab + bc) * 0.9995f);

            // Плоскость сгиба: текущая, а у выпрямленной конечности — по подсказке.
            Vector3 axis = Vector3.Cross(c - a, b - a);
            if (axis.sqrMagnitude < 0.000001f) axis = Vector3.Cross(c - a, hintOffset);
            if (axis.sqrMagnitude < 0.000001f) return 0f;
            axis.Normalize();

            float acAb0 = Angle(c - a, b - a);
            float baBc0 = Angle(a - b, c - b);
            float acAb1 = Mathf.Acos(Mathf.Clamp((bc * bc - ab * ab - at * at) / (-2f * ab * at), -1f, 1f));
            float baBc1 = Mathf.Acos(Mathf.Clamp((at * at - ab * ab - bc * bc) / (-2f * ab * bc), -1f, 1f));
            lower.rotation = Quaternion.AngleAxis((baBc1 - baBc0) * Mathf.Rad2Deg, axis) * lower.rotation;
            upper.rotation = Quaternion.AngleAxis((acAb1 - acAb0) * Mathf.Rad2Deg, axis) * upper.rotation;

            // Цепь целиком на цель.
            c = end.position;
            upper.rotation = Quaternion.FromToRotation(c - a, t - a) * upper.rotation;

            // Плоскость сгиба — к подсказке, вращением вокруг оси «плечо — цель».
            Vector3 toTarget = (t - a).normalized;
            Vector3 bent = Vector3.ProjectOnPlane(lower.position - a, toTarget);
            Vector3 hint = Vector3.ProjectOnPlane((a + t) * 0.5f + hintOffset - a, toTarget);
            if (bent.sqrMagnitude > 0.000001f && hint.sqrMagnitude > 0.000001f)
            {
                float twist = Vector3.SignedAngle(bent, hint, toTarget) * weight;
                upper.rotation = Quaternion.AngleAxis(twist, toTarget) * upper.rotation;
            }

            if (keepEndRotation) end.rotation = endRotation;
            return (end.position - target).magnitude;
        }

        private static float Angle(Vector3 from, Vector3 to)
        {
            float denominator = from.magnitude * to.magnitude;
            if (denominator < 0.000001f) return 0f;
            return Mathf.Acos(Mathf.Clamp(Vector3.Dot(from, to) / denominator, -1f, 1f));
        }
    }
}
