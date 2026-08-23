using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Хват ближнего боя: профили стоек и их смешивание.
    ///
    /// Портирует APPROVED_MELEE_GRIP_PROFILES и approvedMeleePoseState()
    /// из 04d_approved_humanoid_assets_runtime.js:34, 1552.
    ///
    /// В отличие от огнестрела, где поза одна на все стволы, у ближнего боя
    /// три стойки — покой, замах, удар — и оружие ставится не в кисть, а
    /// наоборот: сначала оружие занимает позицию стойки, затем к его рукояти
    /// подтягивается рука.
    ///
    /// Координаты авторские, из правосторонней системы Three.js: по Z они
    /// зеркалятся, а знак крена меняется — как и везде при переносе.
    /// </summary>
    public static class RoaMeleeGrip
    {
        public sealed class Stance
        {
            public Vector3 Primary;
            public Vector3 Direction;
        }

        public sealed class Profile
        {
            public bool TwoHanded;
            public Vector3 SourceAxis;
            public float Roll;
            public Vector3 SupportRotation;

            public Stance Idle;
            public Stance Windup;
            public Stance Strike;

            public Vector3 SpineWindup;
            public Vector3 SpineStrike;
        }

        /// <summary>
        /// Веса доворота позвоночника в позе ближнего боя.
        /// applyApprovedMeleeSpinePose(), 04d:1615.
        /// </summary>
        public static readonly float[] SpineWeights = { 0.18f, 0.34f, 0.48f };
        public static readonly string[] SpineBones = { "spine_01", "spine_02", "spine_03" };

        /// <summary>Длительность замаха по умолчанию, с.</summary>
        public const float DefaultSwingSeconds = 0.36f;

        /// <summary>
        /// Перевод авторских координат стойки в пространство корня модели Unity.
        ///
        /// Преобразований два, и они частично гасят друг друга:
        ///
        /// 1. В web-клиенте корень модели дополнительно повёрнут на π
        ///    (baseRotationY, 04b:966) — стойки заданы именно в этом повёрнутом
        ///    пространстве. Поворот на π вокруг Y меняет знак X и Z.
        /// 2. Переход из правосторонней системы в Unity зеркалит Z.
        ///
        /// В сумме: X инвертируется, Z остаётся как есть. Проверка на здравый
        /// смысл — нож в ПРАВОЙ руке: авторский x = −0.27 после инверсии даёт
        /// +0.27, то есть правую сторону персонажа, смотрящего вперёд.
        /// </summary>
        private static Vector3 V(float x, float y, float z)
        {
            return new Vector3(-x, y, z);
        }

        private static readonly Dictionary<string, Profile> Profiles = new Dictionary<string, Profile>
        {
            {
                "knife", new Profile
                {
                    TwoHanded = false,
                    SourceAxis = V(0f, 1f, 0f),
                    Roll = -0.18f,
                    Idle = new Stance { Primary = V(-0.27f, 1.22f, 0.24f), Direction = V(0.04f, 0.02f, 1f) },
                    Windup = new Stance { Primary = V(-0.34f, 1.40f, 0.08f), Direction = V(0.12f, 0.42f, -0.90f) },
                    Strike = new Stance { Primary = V(-0.16f, 1.18f, 0.56f), Direction = V(0.02f, -0.05f, 1f) },
                    SpineWindup = V(0.04f, -0.20f, -0.06f),
                    SpineStrike = V(-0.10f, 0.18f, 0.05f)
                }
            },
            {
                "pickaxe", new Profile
                {
                    TwoHanded = true,
                    SourceAxis = V(0f, 1f, 0f),
                    Roll = 0.12f,
                    SupportRotation = V(0.06f, 0.02f, 0.12f),
                    Idle = new Stance { Primary = V(-0.22f, 1.18f, 0.22f), Direction = V(0.95f, 0.29f, 0.08f) },
                    Windup = new Stance { Primary = V(-0.31f, 1.47f, 0.05f), Direction = V(0.76f, 0.64f, -0.08f) },
                    Strike = new Stance { Primary = V(-0.22f, 1.04f, 0.53f), Direction = V(0.98f, 0.14f, 0.03f) },
                    SpineWindup = V(0.10f, -0.24f, -0.10f),
                    SpineStrike = V(-0.18f, 0.22f, 0.08f)
                }
            },
            {
                "axe", new Profile
                {
                    TwoHanded = true,
                    SourceAxis = V(0f, 1f, 0f),
                    Roll = 0.24f,
                    SupportRotation = V(0.06f, 0.02f, 0.12f),
                    Idle = new Stance { Primary = V(-0.21f, 1.18f, 0.23f), Direction = V(0.95f, 0.29f, 0.08f) },
                    Windup = new Stance { Primary = V(-0.30f, 1.46f, 0.06f), Direction = V(0.76f, 0.64f, -0.08f) },
                    Strike = new Stance { Primary = V(-0.21f, 1.05f, 0.52f), Direction = V(0.98f, 0.14f, 0.03f) },
                    SpineWindup = V(0.09f, -0.22f, -0.09f),
                    SpineStrike = V(-0.16f, 0.20f, 0.07f)
                }
            },
            {
                "handPump", new Profile
                {
                    TwoHanded = true,
                    SourceAxis = V(0f, 1f, 0f),
                    Roll = -0.08f,
                    SupportRotation = V(0.10f, -0.04f, 0.18f),
                    Idle = new Stance { Primary = V(-0.20f, 1.18f, 0.24f), Direction = V(0.94f, 0.31f, 0.11f) },
                    Windup = new Stance { Primary = V(-0.28f, 1.43f, 0.08f), Direction = V(0.74f, 0.66f, -0.10f) },
                    Strike = new Stance { Primary = V(-0.20f, 1.07f, 0.49f), Direction = V(0.97f, 0.20f, 0.05f) },
                    SpineWindup = V(0.09f, -0.22f, -0.09f),
                    SpineStrike = V(-0.16f, 0.20f, 0.07f)
                }
            }
        };

        public static bool IsMelee(string weaponId)
        {
            return !string.IsNullOrEmpty(weaponId) && Profiles.ContainsKey(weaponId);
        }

        public static Profile Get(string weaponId)
        {
            Profile profile;
            return Profiles.TryGetValue(weaponId ?? string.Empty, out profile) ? profile : null;
        }

        /// <summary>
        /// Смешанная стойка и доворот позвоночника для текущей фазы удара.
        /// Фазы: покой → замах (до 0.34) → удар (до 0.58) → возврат.
        /// </summary>
        public static void Sample(Profile profile, float phase,
                                  out Vector3 primary, out Vector3 direction, out Vector3 spine)
        {
            Stance from;
            Stance to;
            Vector3 spineFrom;
            Vector3 spineTo;
            float blend;

            if (phase < 0f)
            {
                primary = profile.Idle.Primary;
                direction = profile.Idle.Direction.normalized;
                spine = Vector3.zero;
                return;
            }

            if (phase < 0.34f)
            {
                from = profile.Idle; to = profile.Windup;
                spineFrom = Vector3.zero; spineTo = profile.SpineWindup;
                blend = SmoothStep(phase / 0.34f);
            }
            else if (phase < 0.58f)
            {
                from = profile.Windup; to = profile.Strike;
                spineFrom = profile.SpineWindup; spineTo = profile.SpineStrike;
                blend = SmoothStep((phase - 0.34f) / 0.24f);
            }
            else
            {
                from = profile.Strike; to = profile.Idle;
                spineFrom = profile.SpineStrike; spineTo = Vector3.zero;
                blend = SmoothStep((phase - 0.58f) / 0.42f);
            }

            primary = Vector3.Lerp(from.Primary, to.Primary, blend);
            direction = Vector3.Lerp(from.Direction, to.Direction, blend).normalized;
            spine = Vector3.Lerp(spineFrom, spineTo, blend);
        }

        private static float SmoothStep(float value)
        {
            float t = Mathf.Clamp01(value);
            return t * t * (3f - 2f * t);
        }
    }
}
