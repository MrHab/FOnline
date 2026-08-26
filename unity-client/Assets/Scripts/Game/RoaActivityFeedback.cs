using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    public enum RoaActivityFeedbackCue
    {
        None,
        Started,
        Progress,
        ExtractionOpened,
        Success,
        Failure
    }

    /// <summary>Pure transition and animation rules for authoritative world activities.</summary>
    public static class RoaActivityFeedback
    {
        public const float IntroSeconds = 4f;
        public const float ResultSeconds = 12f;
        public const float PulseSeconds = 0.82f;

        public readonly struct CardSample
        {
            public readonly float Alpha;
            public readonly float Scale;
            public readonly float SlideY;

            public CardSample(float alpha, float scale, float slideY)
            {
                Alpha = alpha;
                Scale = scale;
                SlideY = slideY;
            }
        }

        public static RoaActivityFeedbackCue ClassifyActivity(JObject previous, JObject next)
        {
            string nextId = next?["id"]?.ToString() ?? string.Empty;
            if (string.IsNullOrEmpty(nextId)) return RoaActivityFeedbackCue.None;
            string previousId = previous?["id"]?.ToString() ?? string.Empty;
            if (!string.Equals(previousId, nextId, StringComparison.Ordinal))
                return RoaActivityFeedbackCue.Started;

            bool previousExtraction = previous?["extractionOpen"]?.ToObject<bool>() == true;
            bool nextExtraction = next?["extractionOpen"]?.ToObject<bool>() == true;
            if (!previousExtraction && nextExtraction) return RoaActivityFeedbackCue.ExtractionOpened;

            string previousPhase = previous?["phase"]?.ToString() ?? string.Empty;
            string nextPhase = next?["phase"]?.ToString() ?? string.Empty;
            bool phaseChanged = !string.IsNullOrEmpty(previousPhase) && !string.IsNullOrEmpty(nextPhase)
                && !string.Equals(previousPhase, nextPhase, StringComparison.Ordinal);
            return phaseChanged || ObjectiveProgress(next) > ObjectiveProgress(previous)
                ? RoaActivityFeedbackCue.Progress : RoaActivityFeedbackCue.None;
        }

        public static RoaActivityFeedbackCue ClassifyResult(JObject result)
        {
            if (result == null || result["reason"]?.ToString() == "player_died")
                return RoaActivityFeedbackCue.None;
            string status = result["status"]?.ToString() ?? string.Empty;
            return status == "completed" ? RoaActivityFeedbackCue.Success
                : status == "failed" || status == "expired" || status == "resolved"
                    ? RoaActivityFeedbackCue.Failure : RoaActivityFeedbackCue.None;
        }

        public static CardSample SampleCard(float age, float lifetime)
        {
            float enter = Smooth(Mathf.Clamp01(age / 0.22f));
            float exit = Smooth(Mathf.Clamp01((lifetime - age) / 0.48f));
            float alpha = Mathf.Min(enter, exit);
            float scale = 0.965f + enter * 0.035f + Mathf.Sin(enter * Mathf.PI) * 0.018f;
            return new CardSample(alpha, scale, Mathf.Lerp(14f, 0f, enter));
        }

        public static float SamplePulse(float age)
        {
            if (age < 0f || age >= PulseSeconds) return 0f;
            float t = Mathf.Clamp01(age / PulseSeconds);
            return Mathf.Sin(t * Mathf.PI) * (1f - t * 0.15f);
        }

        private static int ObjectiveProgress(JObject activity)
        {
            int sum = 0;
            if (!(activity?["objectives"] is JArray objectives)) return sum;
            foreach (JToken token in objectives)
            {
                int current = Mathf.Clamp(token?["current"]?.ToObject<int>() ?? 0, 0, 100000);
                sum = Mathf.Min(1000000, sum + current);
            }
            return sum;
        }

        private static float Smooth(float value)
        {
            return value * value * (3f - 2f * value);
        }
    }
}
