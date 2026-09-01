using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Deterministic presentation curve for an authoritative hit marker. The
    /// combat result still comes from the server; this class only describes the
    /// short confirmation shown over the target after that result arrives.
    /// </summary>
    public static class RoaCombatConfirmation
    {
        public struct Frame
        {
            public bool Visible;
            public float Radius;
            public float Length;
            public float Thickness;
            public float Alpha;
            public Color Color;
        }

        public const float NormalLifetime = 0.38f;
        public const float KillLifetime = 0.48f;

        public static float Lifetime(bool killed)
        {
            return killed ? KillLifetime : NormalLifetime;
        }

        public static bool Expired(float elapsed, bool killed)
        {
            return elapsed >= Lifetime(killed);
        }

        public static Frame Evaluate(float elapsed, bool critical, bool killed)
        {
            float life = Lifetime(killed);
            if (elapsed < 0f || elapsed >= life) return default;

            float t = Mathf.Clamp01(elapsed / life);
            float settle = 1f - Mathf.Pow(1f - t, 3f);
            float fade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.38f, 1f, t));
            Color color = killed
                ? new Color(1f, 0.43f, 0.27f, 1f)
                : critical
                    ? new Color(1f, 0.82f, 0.30f, 1f)
                    : new Color(0.94f, 0.91f, 0.82f, 1f);

            return new Frame
            {
                Visible = true,
                Radius = Mathf.Lerp(killed ? 30f : critical ? 26f : 23f,
                                    killed ? 13f : 10f, settle),
                Length = killed ? 12f : critical ? 10f : 8f,
                Thickness = killed ? 3f : critical ? 2.5f : 2f,
                Alpha = fade,
                Color = color
            };
        }
    }
}
