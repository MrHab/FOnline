using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Как сложены пальцы кисти на предмете.</summary>
    public enum RoaFingerPose
    {
        /// <summary>Все пальцы обхватывают рукоять, большой — навстречу им.</summary>
        Wrap,
        /// <summary>Хват рукояти огнестрела, указательный на спуске.</summary>
        Trigger,
        /// <summary>Хват рукояти, указательный вытянут вдоль рамки (палец вне спуска).</summary>
        TriggerOff,
        /// <summary>Ладонь снизу цевья, пальцы обхватывают его с другого бока.</summary>
        Cradle,
        /// <summary>Вторая рука на пистолете: пальцы поверх пальцев первой, большой вдоль рамки.</summary>
        Support,
        /// <summary>Свободная ладонь, пальцы слегка согнуты (рука-противовес).</summary>
        Relaxed,
        /// <summary>Пустая кисть на ходу и в стойке: пальцы лишь слегка согнуты.</summary>
        Loose
    }

    /// <summary>
    /// Куда и как положить кисть: ось рукояти (от мизинца к указательному),
    /// сторона тыльной стороны ладони и радиус рукояти — в мире.
    /// </summary>
    public struct RoaHandTarget
    {
        public bool Active;
        public Vector3 Centre;
        public Vector3 Axis;
        public Vector3 Back;
        public float Radius;
        public RoaFingerPose Fingers;
        /// <summary>Куда отводить локоть (точка в мире), если задана.</summary>
        public Vector3 Elbow;
        public bool HasElbow;
    }

    /// <summary>
    /// Кисть одного скелета: её привязочная система (куда смотрят пальцы, где
    /// большой палец, куда обращена ладонь) и цепочки пальцев со сгибом. Всё
    /// снимается с bind-позы скина, поэтому работает и для видимого тела пака, и
    /// для скрытого рига с клипами.
    /// </summary>
    public sealed class RoaHandGrip
    {
        private sealed class Joint
        {
            public Transform Bone;
            public Quaternion RestLocal;
            public Vector3 CurlAxisLocal;
            public Vector3 OppositionAxisLocal;
            public Vector3 SpreadAxisLocal;
        }

        private readonly Transform _hand;
        private readonly bool _left;
        // Оси кисти в её собственной системе (из bind-позы).
        private readonly Vector3 _fingerLocal;
        private readonly Vector3 _lateralLocal;
        private readonly Vector3 _palmLocal;
        // От запястья до центра ладони вдоль пальцев и толщина ладони, м.
        private readonly float _palmReach;
        private const float PalmThickness = 0.016f;
        private readonly List<Joint> _index = new List<Joint>();
        private readonly List<Joint> _fingers = new List<Joint>();
        private readonly List<Joint> _thumb = new List<Joint>();

        public Transform Hand => _hand;
        public bool Ready { get; }

        /// <summary>
        /// bind — мировые матрицы костей в bind-позе (любая общая система);
        /// index/fingers/thumb — цепочки от основания к концу.
        /// </summary>
        public RoaHandGrip(Transform hand, bool left, IReadOnlyDictionary<Transform, Matrix4x4> bind,
            Transform[] index, Transform[] fingers, Transform[] thumb)
        {
            _hand = hand;
            _left = left;
            if (hand == null || bind == null || !bind.ContainsKey(hand) || index == null || index.Length == 0
                || fingers == null || fingers.Length == 0 || !bind.ContainsKey(index[0]) || !bind.ContainsKey(fingers[0]))
                return;
            Matrix4x4 handBind = bind[hand];
            Vector3 wrist = handBind.GetColumn(3);
            Vector3 indexBase = bind[index[0]].GetColumn(3);
            Vector3 fingerBase = bind[fingers[0]].GetColumn(3);
            Vector3 knuckles = (indexBase + fingerBase) * 0.5f;
            Vector3 finger = (knuckles - wrist).normalized;
            Vector3 lateral = Vector3.ProjectOnPlane(indexBase - fingerBase, finger).normalized;
            // Ладонь: для правой кисти cross(палец, к указательному), для левой — наоборот.
            Vector3 palm = Vector3.Cross(finger, lateral) * (left ? -1f : 1f);
            Quaternion handRot = handBind.rotation;
            Quaternion toHand = Quaternion.Inverse(handRot);
            _fingerLocal = toHand * finger;
            _lateralLocal = toHand * lateral;
            _palmLocal = toHand * palm;
            _palmReach = (knuckles - wrist).magnitude * 0.72f;
            Vector3 curl = Vector3.Cross(finger, palm);
            Vector3 opposition = Vector3.Cross(lateral, palm);
            // Отвод пальца в сторону указательного (к оси рукояти): палец ложится над скобой.
            Vector3 spread = Vector3.Cross(finger, lateral);
            Build(_index, index, bind, curl, opposition, spread);
            Build(_fingers, fingers, bind, curl, opposition, spread);
            if (thumb != null && thumb.Length > 0 && bind.ContainsKey(thumb[0]))
            {
                Vector3 thumbDir = thumb.Length > 1 && bind.ContainsKey(thumb[1])
                    ? ((Vector3)bind[thumb[1]].GetColumn(3) - (Vector3)bind[thumb[0]].GetColumn(3)).normalized : finger;
                // Большой палец гнётся к ладони поперёк своего направления.
                Vector3 thumbCurl = Vector3.Cross(thumbDir, palm);
                Build(_thumb, thumb, bind, thumbCurl, opposition, opposition);
            }
            Ready = true;
        }

        private static void Build(List<Joint> output, Transform[] chain, IReadOnlyDictionary<Transform, Matrix4x4> bind,
            Vector3 curlWorld, Vector3 oppositionWorld, Vector3 spreadWorld)
        {
            foreach (Transform bone in chain)
            {
                if (bone == null || bone.parent == null || !bind.ContainsKey(bone) || !bind.ContainsKey(bone.parent)) continue;
                Quaternion rot = bind[bone].rotation;
                output.Add(new Joint
                {
                    Bone = bone,
                    RestLocal = Quaternion.Inverse(bind[bone.parent].rotation) * rot,
                    CurlAxisLocal = (Quaternion.Inverse(rot) * curlWorld).normalized,
                    OppositionAxisLocal = (Quaternion.Inverse(rot) * oppositionWorld).normalized,
                    SpreadAxisLocal = (Quaternion.Inverse(rot) * spreadWorld).normalized
                });
            }
        }

        /// <summary>
        /// Мировой поворот кисти, при котором указательный лежит по оси рукояти
        /// (axis), а тыльная сторона смотрит в back.
        /// </summary>
        public Quaternion RotationFor(Vector3 axis, Vector3 back)
        {
            Vector3 lateral = axis.normalized;
            Vector3 palm = -Vector3.ProjectOnPlane(back, lateral).normalized;
            Vector3 finger = Vector3.Cross(lateral, palm) * (_left ? -1f : 1f);
            Quaternion want = Quaternion.LookRotation(finger, palm);
            Quaternion have = Quaternion.LookRotation(_fingerLocal, _palmLocal);
            return want * Quaternion.Inverse(have);
        }

        /// <summary>Где должно быть запястье, чтобы рукоять легла поперёк ладони.</summary>
        public Vector3 WristFor(RoaHandTarget target, Quaternion rotation)
        {
            Vector3 finger = rotation * _fingerLocal;
            Vector3 palm = rotation * _palmLocal;
            return target.Centre - palm * (target.Radius + PalmThickness) - finger * _palmReach;
        }

        /// <summary>Где сейчас рукоять в этой кисти: центр, ось от мизинца к указательному, тыл.</summary>
        public void HeldFrame(float radius, out Vector3 centre, out Vector3 axis, out Vector3 back, float intoFingers = 0f)
        {
            Quaternion rotation = _hand.rotation;
            axis = rotation * _lateralLocal;
            Vector3 palm = rotation * _palmLocal;
            back = -palm;
            centre = _hand.position + rotation * _fingerLocal * (_palmReach + intoFingers) + palm * (radius + PalmThickness);
        }

        /// <summary>Центр ладони текущей кисти (для замера промаха).</summary>
        public Vector3 PalmCentre(float radius)
        {
            Quaternion rotation = _hand.rotation;
            return _hand.position + rotation * _fingerLocal * _palmReach + rotation * _palmLocal * (radius + PalmThickness);
        }

        /// <summary>Согнуть пальцы вокруг рукояти радиуса radius.</summary>
        public void ApplyFingers(RoaFingerPose pose, float radius)
        {
            if (!Ready) return;
            // Чем тоньше рукоять, тем сильнее сгиб: сегмент пальца обходит окружность.
            // Чем толще рукоять, тем меньше сгиб: 70° на тонкой (2.4 см), ~55° на цевье (5–6 см).
            float wrap = Mathf.Clamp(70f - (radius - 0.012f) * 900f, 45f, 78f);
            switch (pose)
            {
                case RoaFingerPose.Trigger:
                    Curl(_index, 18f, 42f, 28f);
                    Curl(_fingers, wrap * 1.05f, wrap * 1.1f, wrap * 0.8f);
                    Thumb(58f, 22f, 18f);
                    break;
                case RoaFingerPose.TriggerOff:
                    // Палец вне спуска: прямой, вдоль рамки над скобой.
                    Curl(_index, 2f, 4f, 3f);
                    Spread(_index, 14f);
                    Curl(_fingers, wrap * 1.05f, wrap * 1.1f, wrap * 0.8f);
                    Thumb(58f, 22f, 18f);
                    break;
                case RoaFingerPose.Cradle:
                    // Пальцы закрывают цевьё с дальнего бока, большой — вдоль ближнего.
                    Curl(_index, wrap * 1.05f, wrap * 1.1f, wrap * 0.9f);
                    Curl(_fingers, wrap * 1.1f, wrap * 1.15f, wrap * 0.95f);
                    Thumb(28f, 12f, 10f);
                    break;
                case RoaFingerPose.Relaxed:
                    // Свободная рука — мягкий полукулак, а не растопыренная ладонь.
                    Curl(_index, 32f, 42f, 28f);
                    Curl(_fingers, 42f, 52f, 36f);
                    Thumb(30f, 14f, 10f);
                    break;
                case RoaFingerPose.Loose:
                    // Расслабленная кисть: пальцы согнуты дугой, мизинец сильнее указательного.
                    Curl(_index, 14f, 20f, 12f);
                    Curl(_fingers, 20f, 28f, 18f);
                    Thumb(18f, 8f, 6f);
                    break;
                case RoaFingerPose.Support:
                    Curl(_index, wrap * 0.9f, wrap, wrap * 0.7f);
                    Curl(_fingers, wrap * 0.95f, wrap, wrap * 0.75f);
                    Thumb(12f, 6f, 4f);
                    break;
                default:
                    Curl(_index, wrap * 0.95f, wrap * 1.05f, wrap * 0.8f);
                    Curl(_fingers, wrap, wrap * 1.1f, wrap * 0.85f);
                    Thumb(62f, 26f, 22f);
                    break;
            }
        }

        private static void Curl(List<Joint> chain, float a, float b, float c)
        {
            for (int i = 0; i < chain.Count; i++)
            {
                float angle = i == 0 ? a : (i == 1 ? b : c);
                Joint joint = chain[i];
                joint.Bone.localRotation = joint.RestLocal * Quaternion.AngleAxis(angle, joint.CurlAxisLocal);
            }
        }

        private static void Spread(List<Joint> chain, float angle)
        {
            if (chain.Count == 0) return;
            Joint joint = chain[0];
            joint.Bone.localRotation = joint.Bone.localRotation * Quaternion.AngleAxis(angle, joint.SpreadAxisLocal);
        }

        private void Thumb(float opposition, float flexA, float flexB)
        {
            for (int i = 0; i < _thumb.Count; i++)
            {
                Joint joint = _thumb[i];
                Quaternion local = joint.RestLocal;
                if (i == 0) local *= Quaternion.AngleAxis(opposition, joint.OppositionAxisLocal);
                float flex = i == 0 ? 0f : (i == 1 ? flexA : flexB);
                joint.Bone.localRotation = local * Quaternion.AngleAxis(flex, joint.CurlAxisLocal);
            }
        }
    }
}
