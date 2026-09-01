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
            Require(RoaActivityFeedback.GlobalMapResultSeconds <= 8f
                    && RoaActivityFeedback.GlobalMapResultSeconds < RoaActivityFeedback.ResultSeconds,
                "activity result blocks the global map for too long");
            Require(!RoaWorldActivityCanvas.UseFocusedActivityHud(false, false)
                    && RoaWorldActivityCanvas.UseFocusedActivityHud(true, false)
                    && RoaWorldActivityCanvas.UseFocusedActivityHud(false, true)
                    && RoaWorldActivityCanvas.ActivityHudSize(false) == new Vector2(330f, 210f)
                    && RoaWorldActivityCanvas.ActivityHudSize(true) == new Vector2(330f, 144f)
                    && RoaWorldActivityCanvas.ActivityHudSize(
                        RoaWorldActivityCanvas.ActivityHudDensity.Glance) == new Vector2(330f, 100f)
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false,
                        false, false, false, false)
                        == RoaWorldActivityCanvas.ActivityHudDensity.Glance
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(true, false,
                        false, false, false, false)
                        == RoaWorldActivityCanvas.ActivityHudDensity.Glance
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false,
                        false, false, true, false)
                        == RoaWorldActivityCanvas.ActivityHudDensity.Context
                    && RoaWorldActivityCanvas.ResolveActivityHudDensity(false, false,
                        true, false, false, false)
                        == RoaWorldActivityCanvas.ActivityHudDensity.Detailed,
                "activity HUD density no longer releases the world or expands contextually");
            Require(RoaWorldActivityCanvas.FocusedObjectiveIndex(objectiveViews) >= 0
                    && objectiveViews[RoaWorldActivityCanvas.FocusedObjectiveIndex(objectiveViews)].IsCurrent,
                "focused activity HUD does not select the current objective");

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
                Transform compactHud = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud");
                Transform activityFlow = compactHud?.Find("ActivityFlow");
                Transform resultFlow = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityResult/ResultFlow");
                Require(objectiveRows != null && objectiveRows.childCount == 3
                        && activityCanvas.ObjectiveRowPoolSize == 3,
                    "activity Canvas does not prebuild the bounded three-row objective pool");
                RectTransform compactHudRect = compactHud as RectTransform;
                Require(compactHudRect != null
                        && compactHudRect.anchorMin == new Vector2(0f, 1f)
                        && compactHudRect.anchorMax == new Vector2(0f, 1f)
                        && compactHudRect.sizeDelta.x <= 330f
                        && compactHudRect.sizeDelta == new Vector2(330f, 100f)
                        && activityFlow != null && activityFlow.childCount == 4
                        && resultFlow != null && resultFlow.childCount == 4,
                    "persistent activity HUD is not a glance card docked below player status");
                var applyDensity = typeof(RoaWorldActivityCanvas).GetMethod("ApplyHudDensityLayout",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                Require(applyDensity != null, "activity HUD density layout entry point is missing");
                applyDensity.Invoke(activityCanvas, new object[] {
                    RoaWorldActivityCanvas.ActivityHudDensity.Glance });
                Transform phaseTransform = compactHud.Find("Phase");
                Require(compactHudRect.sizeDelta == new Vector2(330f, 100f)
                        && activityCanvas.FocusedHud
                        && phaseTransform != null && !phaseTransform.gameObject.activeSelf
                        && ((RectTransform)objectiveRows).rect.height <= 24f,
                    "glance activity HUD is not reduced to one readable objective row");
                applyDensity.Invoke(activityCanvas, new object[] {
                    RoaWorldActivityCanvas.ActivityHudDensity.Context });
                Require(compactHudRect.sizeDelta == new Vector2(330f, 144f)
                        && activityCanvas.HudDensity == RoaWorldActivityCanvas.ActivityHudDensity.Context,
                    "nearby action or important message does not expand the activity HUD context");
                applyDensity.Invoke(activityCanvas, new object[] {
                    RoaWorldActivityCanvas.ActivityHudDensity.Detailed });
                Require(compactHudRect.sizeDelta == new Vector2(330f, 210f)
                        && !activityCanvas.FocusedHud && phaseTransform.gameObject.activeSelf,
                    "manual activity details do not restore the full tactical card");
                Transform helpButton = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud/Btn:ActivityHelp");
                Transform detailsButton = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud/Btn:ActivityDetails");
                Transform continueButton = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityResult/Btn:ActivityContinue");
                Transform reviveButton = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud/Btn:ActivityRevive");
                Transform pingToggle = canvasHost.transform.Find(
                    "WorldActivityCanvas/WorldActivityHud/Btn:ActivityPingToggle");
                Transform pingMenu = canvasHost.transform.Find(
                    "WorldActivityCanvas/PingRadial");
                Transform movePing = canvasHost.transform.Find(
                    "WorldActivityCanvas/PingRadial/Btn:ActivityPing:Move");
                Transform dangerPing = canvasHost.transform.Find(
                    "WorldActivityCanvas/PingRadial/Btn:ActivityPing:Danger");
                Transform lootPing = canvasHost.transform.Find(
                    "WorldActivityCanvas/PingRadial/Btn:ActivityPing:Loot");
                Require(detailsButton != null && detailsButton.GetComponent<Button>() != null
                        && ((RectTransform)detailsButton).rect.width >= 44f
                        && ((RectTransform)detailsButton).rect.height >= 44f,
                    "activity glance card has no explicit details control");
                Require(helpButton != null && helpButton.GetComponent<Button>() != null,
                    "running activity has no live help action");
                Require(continueButton != null && continueButton.GetComponent<Button>() != null,
                    "successful result has no continue-with-squad action");
                Require(reviveButton != null && reviveButton.GetComponent<Button>() != null,
                    "temporary squad has no nearby-teammate revive action");
                Require(pingToggle != null && pingToggle.GetComponent<Button>() != null
                        && pingMenu != null && !pingMenu.gameObject.activeSelf,
                    "squad pings are not collapsed behind a contextual control");
                Require(movePing != null && dangerPing != null && lootPing != null
                        && ((RectTransform)movePing).rect.height >= 44f,
                    "temporary squad quick pings are missing or unreadably small");
                Require(RoaWorldActivityCanvas.ResolvePingRadialType(new Vector2(0f, 70f), false) == "danger"
                        && RoaWorldActivityCanvas.ResolvePingRadialType(new Vector2(-70f, -50f), false) == "move"
                        && RoaWorldActivityCanvas.ResolvePingRadialType(new Vector2(70f, -50f), false) == "loot"
                        && RoaWorldActivityCanvas.ResolvePingRadialType(Vector2.zero, true) == "move"
                        && string.IsNullOrEmpty(RoaWorldActivityCanvas.ResolvePingRadialType(Vector2.zero, false)),
                    "desktop/mobile radial ping directions are ambiguous");
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
