#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaFirstRunCoachProbe
    {
        private const string RequestName = "RoaFirstRunCoachProbe.request";
        private static double _nextRequestCheck;

        static RoaFirstRunCoachProbe()
        {
            EditorApplication.update += PollRequest;
        }

        private static void PollRequest()
        {
            if (EditorApplication.timeSinceStartup < _nextRequestCheck) return;
            _nextRequestCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string root = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrEmpty(root)) return;
            string request = Path.Combine(root, "Library", RequestName);
            if (!File.Exists(request)) return;
            File.Delete(request);
            Run();
        }

        [MenuItem("Realm of Ashes/Проверить первый выход")]
        private static void Run()
        {
            GameObject host = null;
            GameObject activityHost = null;
            GameObject exitHost = null;
            try
            {
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Movement,
                        true, false, false, false, false, false)
                        == RoaFirstRunCoach.CoachStep.Interaction,
                        "movement does not advance the coach");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Interaction,
                        false, true, false, false, false, false)
                        == RoaFirstRunCoach.CoachStep.Activity,
                        "a real interaction does not advance the coach");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Interaction,
                        false, false, true, false, false, false)
                        == RoaFirstRunCoach.CoachStep.Activity,
                        "reaching the global map can trap the interaction step");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Activity,
                        false, false, false, true, false, false)
                        == RoaFirstRunCoach.CoachStep.Mission,
                        "starting an activity must hand guidance to the mission HUD");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Mission,
                        false, false, false, false, true, false)
                        == RoaFirstRunCoach.CoachStep.Complete,
                        "a matching successful result does not complete onboarding");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Mission,
                        false, false, false, false, false, true)
                        == RoaFirstRunCoach.CoachStep.Activity,
                        "a failed result does not return onboarding to activity selection");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Mission,
                        false, false, true, false, false, false)
                        == RoaFirstRunCoach.CoachStep.Activity,
                        "an abandoned mission traps onboarding");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Movement,
                        false, false).Contains("WASD"), "desktop movement copy is missing");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Movement,
                        true, false).Contains("Левый палец"), "mobile movement copy is missing");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Activity,
                        false, true).Contains("ВЗЯТЬ И ЕХАТЬ"), "global-map action is unclear");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Mission,
                        false, false).Contains("ЭВАКУАЦИЯ"), "mission extraction guidance is missing");

                var regularLocation = new LocationDefinition();
                var lockedTutorialLocation = new LocationDefinition { AllowGlobalMapExit = false };
                Require(regularLocation.CanExitToGlobalMap,
                    "locations without an authored override lost their global-map exit");
                Require(!lockedTutorialLocation.CanExitToGlobalMap,
                    "the tutorial location cannot disable its global-map exit");
                var brokenTract = new LocationDefinition { Id = "randomRuinedRoad" };
                Require(!RoaGameBootstrap.AllowsGlobalMapExit(brokenTract, "firstMission"),
                    "Broken Tract exposes the global map while the prologue is active");
                Require(RoaGameBootstrap.AllowsGlobalMapExit(brokenTract, "complete"),
                    "ordinary Broken Tract instances lost their global-map exit");

                host = new GameObject("FirstRunCoachProbe");
                RoaFirstRunCoach coach = host.AddComponent<RoaFirstRunCoach>();
                coach.Configure(null);
                Transform panel = host.transform.Find("FirstRunCoachCanvas/SafeArea/CoachPanel");
                Require(panel != null, "coach panel was not built");
                Require(((RectTransform)panel).anchorMin.y == 1f, "coach is not anchored to the safe top edge");
                int raycastGraphics = 0;
                foreach (Graphic graphic in panel.GetComponentsInChildren<Graphic>(true))
                {
                    if (!graphic.raycastTarget) continue;
                    raycastGraphics++;
                    Require(graphic.GetComponent<Button>() != null,
                            "coach blocks gameplay input outside the skip button: " + graphic.name);
                }
                Require(raycastGraphics == 1, "coach must expose exactly one clickable graphic");
                Require(panel.Find("Step4") != null, "full-route coach does not expose four progress steps");

                activityHost = new GameObject("FirstRunActivityResultProbe");
                RoaWorldActivityCanvas activity = activityHost.AddComponent<RoaWorldActivityCanvas>();
                MethodInfo handleResult = typeof(RoaWorldActivityCanvas).GetMethod(
                    "HandleAuthoritativeSelf", BindingFlags.Instance | BindingFlags.NonPublic);
                Require(handleResult != null, "authoritative activity result handler is missing");
                handleResult.Invoke(activity, new object[]
                {
                    new JObject
                    {
                        ["lastWorldActivityResult"] = new JObject
                        {
                            ["id"] = "activity_test:completed:paid",
                            ["taskId"] = "activity_test",
                            ["title"] = "Проверочная вылазка",
                            ["status"] = "completed",
                            ["grade"] = "completed",
                            ["rewardClaimed"] = true,
                            ["reward"] = new JObject { ["xp"] = 25, ["caps"] = 10 }
                        }
                    }
                });
                Require(activity.LastResultTaskId == "activity_test"
                        && activity.LastResultSucceeded && activity.LastResultRewardClaimed,
                    "coach cannot observe the matching authoritative paid result");

                exitHost = new GameObject("WorldExitBoundaryProbe");
                RoaWorldExitBoundary boundary = exitHost.AddComponent<RoaWorldExitBoundary>();
                boundary.Configure(38, 38);
                Transform visual = exitHost.transform.Find("GlobalMapExitBoundary");
                Require(visual != null, "global-map exit boundary was not built");
                Require(visual.Find("ExitBand") != null
                        && visual.Find("ExitThresholdLine") != null
                        && visual.Find("OutwardExitArrows") != null,
                    "exit band, threshold or outward arrows are missing");
                Require(boundary.BeaconCount >= 12,
                    "exit boundary is not readable from the middle of a standard location");
                Transform locked = exitHost.transform.Find("ClosedLocationBoundary");
                Require(locked != null && locked.Find("LockedDashedPerimeter") != null,
                    "closed locations have no visible dashed perimeter");
                Require(boundary.LockedColliderCount == 4,
                    "closed location perimeter must have four physical boundary colliders");
                Require(!RoaWorldExitBoundary.IsInExitBand(Vector3.zero, 38, 38)
                        && RoaWorldExitBoundary.IsInExitBand(new Vector3(-35f, 0f, 0f), 38, 38)
                        && !RoaWorldExitBoundary.IsInExitBand(new Vector3(-33f, 0f, 0f), 38, 38),
                    "visual two-tile threshold does not match automatic exit coordinates");
                Debug.Log("[WORLD EXIT BOUNDARY] PASS: exit band plus dashed four-wall locked perimeter");

                Debug.Log("[ПЕРВЫЙ ВЫХОД] готово: движение → взаимодействие → живая карта → активность → результат");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПЕРВЫЙ ВЫХОД] ошибка: " + error.Message);
            }
            finally
            {
                if (exitHost != null) UnityEngine.Object.DestroyImmediate(exitHost);
                if (activityHost != null) UnityEngine.Object.DestroyImmediate(activityHost);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        public static void RunBatch()
        {
            Run();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
