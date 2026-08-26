#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaActivityFeedbackProbe
    {
        [MenuItem("Realm of Ashes/Проверить обратную связь активности")]
        public static void Run()
        {
            JObject start = Activity("activity:probe", 0, false, "search");
            Require(RoaActivityFeedback.ClassifyActivity(null, start) == RoaActivityFeedbackCue.Started,
                "new authoritative activity has no start cue");
            JObject repeated = (JObject)start.DeepClone();
            repeated["revision"] = 2;
            repeated["threat"] = 37;
            Require(RoaActivityFeedback.ClassifyActivity(start, repeated) == RoaActivityFeedbackCue.None,
                "ordinary snapshot revision replays feedback");

            JObject progress = Activity("activity:probe", 1, false, "search");
            Require(RoaActivityFeedback.ClassifyActivity(repeated, progress) == RoaActivityFeedbackCue.Progress,
                "objective progress has no restrained cue");
            JObject phase = Activity("activity:probe", 1, false, "ambush");
            Require(RoaActivityFeedback.ClassifyActivity(progress, phase) == RoaActivityFeedbackCue.Progress,
                "phase change has no cue");
            JObject extraction = Activity("activity:probe", 2, true, "extraction");
            Require(RoaActivityFeedback.ClassifyActivity(phase, extraction)
                    == RoaActivityFeedbackCue.ExtractionOpened,
                "extraction opening is not prioritized over progress");

            Require(RoaActivityFeedback.ClassifyResult(new JObject { ["status"] = "completed" })
                    == RoaActivityFeedbackCue.Success,
                "completed result has no success cue");
            Require(RoaActivityFeedback.ClassifyResult(new JObject { ["status"] = "resolved" })
                    == RoaActivityFeedbackCue.Failure,
                "uncredited result has no failure cue");
            Require(RoaActivityFeedback.ClassifyResult(new JObject
                    { ["status"] = "failed", ["reason"] = "player_died" })
                    == RoaActivityFeedbackCue.None,
                "death recovery duplicates the activity failure cue");

            RoaActivityFeedback.CardSample hidden = RoaActivityFeedback.SampleCard(0f,
                RoaActivityFeedback.IntroSeconds);
            RoaActivityFeedback.CardSample shown = RoaActivityFeedback.SampleCard(0.3f,
                RoaActivityFeedback.IntroSeconds);
            RoaActivityFeedback.CardSample faded = RoaActivityFeedback.SampleCard(
                RoaActivityFeedback.IntroSeconds, RoaActivityFeedback.IntroSeconds);
            Require(hidden.Alpha < 0.001f && hidden.Scale < 1f && hidden.SlideY > 10f,
                "intro card does not enter from a quiet offset");
            Require(shown.Alpha > 0.99f && Mathf.Abs(shown.Scale - 1f) < 0.01f
                    && shown.SlideY < 0.01f,
                "intro card does not settle cleanly");
            Require(faded.Alpha < 0.001f,
                "intro card does not leave at the end of its lifetime");
            Require(RoaActivityFeedback.SamplePulse(0f) == 0f
                    && RoaActivityFeedback.SamplePulse(0.4f) > 0.7f
                    && RoaActivityFeedback.SamplePulse(RoaActivityFeedback.PulseSeconds) == 0f,
                "objective pulse envelope is not bounded");

            GameObject audioHost = null;
            try
            {
                audioHost = new GameObject("Activity feedback audio probe");
                RoaAudio audio = audioHost.AddComponent<RoaAudio>();
                if (!audio.ActivityCuesReady)
                {
                    var awake = typeof(RoaAudio).GetMethod("Awake",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    Require(awake != null, "audio initialization entry point is missing");
                    awake.Invoke(audio, null);
                }
                Require(audio.ActivityCuesReady && audio.GeneratedClipCount == 31,
                    "the five generated activity cues are incomplete or invalid; generated="
                    + audio.GeneratedClipCount);
            }
            finally
            {
                if (audioHost != null) UnityEngine.Object.DestroyImmediate(audioHost);
            }

            Debug.Log("[ОБРАТНАЯ СВЯЗЬ АКТИВНОСТИ] готово: старт → прогресс → эвакуация, "
                + "результат=успех/провал, карточки=fade+slide, сигналы=5/5");
        }

        private static JObject Activity(string id, int current, bool extractionOpen, string phase)
        {
            return new JObject
            {
                ["id"] = id,
                ["revision"] = current + 1,
                ["phase"] = phase,
                ["extractionOpen"] = extractionOpen,
                ["objectives"] = new JArray
                {
                    new JObject { ["id"] = "primary", ["current"] = current, ["target"] = 2 }
                }
            };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
