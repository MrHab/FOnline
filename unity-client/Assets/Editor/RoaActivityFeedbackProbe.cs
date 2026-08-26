#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

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

            JObject paidResult = new JObject
            {
                ["status"] = "completed",
                ["rewardClaimed"] = true,
                ["reward"] = new JObject
                {
                    ["xp"] = 25,
                    ["caps"] = 10,
                    ["reputation"] = 2,
                    ["reputationFactionId"] = "old_klim"
                }
            };
            JObject paidSelf = new JObject
            {
                ["inventory"] = new JArray(new JObject { ["id"] = "silver", ["qty"] = 117 }),
                ["level"] = 3,
                ["xp"] = 55,
                ["xpNeeded"] = 100,
                ["worldFactionReputation"] = new JObject { ["old_klim"] = 14 }
            };
            string receipt = RoaWorldActivityCanvas.RewardReceipt(paidResult, paidSelf);
            Require(receipt.Contains("+25 XP") && receipt.Contains("+10 крышек")
                    && receipt.Contains("ПОДТВЕРЖДЕНО СЕРВЕРОМ")
                    && receipt.Contains("баланс 117 крышек") && receipt.Contains("XP 55/100")
                    && receipt.Contains("Старый Клим 14"),
                "paid activity result has no authoritative reward receipt");
            JObject pendingResult = (JObject)paidResult.DeepClone();
            pendingResult["rewardClaimed"] = false;
            pendingResult["reason"] = "reward_inventory_full";
            Require(RoaWorldActivityCanvas.RewardReceipt(pendingResult, paidSelf)
                    .Contains("освободите место для крышек"),
                "blocked reward receipt does not explain how payment resumes");

            var objectiveViews = new List<RoaWorldActivityCanvas.ObjectiveView>();
            JObject distress = ActivityPlan("distress_signal",
                Objective("distress_signal", "Найти источник сигнала", 0, 1, 1, 1, true),
                Objective("attackers", "Зачистить засаду", 0, 4, 6, 9, true));
            RoaWorldActivityCanvas.BuildObjectiveViews(distress, objectiveViews);
            Require(objectiveViews.Count == 2 && objectiveViews[0].IsCurrent
                    && objectiveViews[0].State == RoaWorldActivityCanvas.ObjectiveVisualState.Active
                    && objectiveViews[1].State == RoaWorldActivityCanvas.ObjectiveVisualState.Locked,
                "distress signal does not reveal a clear ordered plan");
            ObjectiveAt(distress, 0)["current"] = 1;
            RoaWorldActivityCanvas.BuildObjectiveViews(distress, objectiveViews);
            Require(objectiveViews[0].State == RoaWorldActivityCanvas.ObjectiveVisualState.Complete
                    && objectiveViews[1].IsCurrent,
                "clearing the distress beacon does not advance the visible objective");
            ObjectiveAt(distress, 1)["current"] = 4;
            distress["extractionOpen"] = true;
            RoaWorldActivityCanvas.BuildObjectiveViews(distress, objectiveViews);
            Require(objectiveViews.Count == 3 && objectiveViews[2].Id == "extraction"
                    && objectiveViews[2].IsCurrent && objectiveViews[1].Progress.Contains("ОСНОВА ГОТОВА"),
                "opened rescue completion has no explicit final step or bonus milestone");

            JObject operation = ActivityPlan("assault_diversion",
                Objective("approach", "Выбрать подход", 0, 1, 1, 1, true),
                Objective("attackers", "Сломить защитников", 0, 5, 7, 9, false),
                Objective("sabotage", "Вывести объекты из строя", 0, 3, 4, 4, false));
            RoaWorldActivityCanvas.BuildObjectiveViews(operation, objectiveViews);
            Require(objectiveViews.Count == 3 && objectiveViews[0].IsCurrent
                    && objectiveViews[1].Progress == "ПОСЛЕ ВЫБОРА"
                    && objectiveViews[2].Label.StartsWith("Диверсия:"),
                "assault/diversion planning does not preview both mutually exclusive branches");
            operation["approach"] = "diversion";
            ObjectiveAt(operation, 0)["current"] = 1;
            ObjectiveAt(operation, 2)["required"] = true;
            RoaWorldActivityCanvas.BuildObjectiveViews(operation, objectiveViews);
            Require(objectiveViews.Count == 2 && objectiveViews[0].Id == "approach"
                    && objectiveViews[1].Id == "sabotage" && objectiveViews[1].IsCurrent,
                "selected diversion branch does not replace the discarded assault branch");

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
            GameObject canvasHost = null;
            try
            {
                canvasHost = new GameObject("Activity objective Canvas probe");
                RoaWorldActivityCanvas activityCanvas = canvasHost.AddComponent<RoaWorldActivityCanvas>();
                var ensureBuilt = typeof(RoaWorldActivityCanvas).GetMethod("EnsureBuilt",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                Require(ensureBuilt != null, "activity Canvas build entry point is missing");
                ensureBuilt.Invoke(activityCanvas, null);
                Transform objectiveRows = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud/ObjectiveRows");
                Require(objectiveRows != null && objectiveRows.childCount == 3
                        && activityCanvas.ObjectiveRowPoolSize == 3,
                    "activity Canvas does not prebuild the bounded three-row objective pool");
                foreach (Image image in canvasHost.GetComponentsInChildren<Image>(true))
                {
                    bool interactive = image.GetComponent<Button>() != null;
                    Require(image.raycastTarget == interactive,
                        image.name + " has an invalid activity HUD raycast state");
                }
                foreach (Text text in objectiveRows.GetComponentsInChildren<Text>(true))
                    Require(!text.raycastTarget, "objective text intercepts gameplay input");

                audioHost = new GameObject("Activity feedback audio probe");
                RoaAudio audio = audioHost.AddComponent<RoaAudio>();
                if (!audio.ActivityCuesReady)
                {
                    var awake = typeof(RoaAudio).GetMethod("Awake",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    Require(awake != null, "audio initialization entry point is missing");
                    awake.Invoke(audio, null);
                }
                Require(audio.ActivityCuesReady && audio.GeneratedClipCount == 32,
                    "the five generated activity cues are incomplete or invalid; generated="
                    + audio.GeneratedClipCount);
            }
            finally
            {
                if (audioHost != null) UnityEngine.Object.DestroyImmediate(audioHost);
                if (canvasHost != null) UnityEngine.Object.DestroyImmediate(canvasHost);
            }

            Debug.Log("[ОБРАТНАЯ СВЯЗЬ АКТИВНОСТИ] готово: старт → прогресс → эвакуация, "
                + "цели=этапы/ветки/бонус/финал, результат=успех/провал/квитанция, карточки=fade+slide, сигналы=5/5");
        }

        private static JObject ActivityPlan(string kind, params JObject[] objectives)
        {
            return new JObject
            {
                ["kind"] = kind,
                ["approach"] = string.Empty,
                ["extractionOpen"] = false,
                ["objectives"] = new JArray(objectives)
            };
        }

        private static JObject Objective(string id, string label, int current, int target,
                                         int bonus, int maximum, bool required)
        {
            return new JObject
            {
                ["id"] = id,
                ["label"] = label,
                ["current"] = current,
                ["target"] = target,
                ["bonusTarget"] = bonus,
                ["maxTarget"] = maximum,
                ["required"] = required
            };
        }

        private static JObject ObjectiveAt(JObject activity, int index)
        {
            return ((activity?["objectives"] as JArray)?[index] as JObject) ?? new JObject();
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
