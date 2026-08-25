#if UNITY_EDITOR
using System;
using System.IO;
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
            try
            {
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Movement,
                        true, false, false, false) == RoaFirstRunCoach.CoachStep.Interaction,
                        "movement does not advance the coach");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Interaction,
                        false, true, false, false) == RoaFirstRunCoach.CoachStep.Activity,
                        "a real interaction does not advance the coach");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Interaction,
                        false, false, true, false) == RoaFirstRunCoach.CoachStep.Activity,
                        "reaching the global map can trap the interaction step");
                Require(RoaFirstRunCoach.ResolveStep(RoaFirstRunCoach.CoachStep.Activity,
                        false, false, false, true) == RoaFirstRunCoach.CoachStep.Complete,
                        "starting an activity does not complete onboarding");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Movement,
                        false, false).Contains("WASD"), "desktop movement copy is missing");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Movement,
                        true, false).Contains("Левый палец"), "mobile movement copy is missing");
                Require(RoaFirstRunCoach.InstructionFor(RoaFirstRunCoach.CoachStep.Activity,
                        false, true).Contains("ВЗЯТЬ И ЕХАТЬ"), "global-map action is unclear");

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

                Debug.Log("[ПЕРВЫЙ ВЫХОД] готово: движение → взаимодействие → живая карта → активность");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПЕРВЫЙ ВЫХОД] ошибка: " + error.Message);
            }
            finally
            {
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
