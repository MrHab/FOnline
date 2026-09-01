#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
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

                Debug.Log("[ПЕРВЫЙ ВЫХОД] готово: движение → взаимодействие → живая карта → активность → результат");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПЕРВЫЙ ВЫХОД] ошибка: " + error.Message);
            }
            finally
            {
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
