#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaHudInteractionPromptProbe
    {
        private const string RequestName = "RoaHudInteractionPromptProbe.request";
        private static double _nextRequestCheck;

        static RoaHudInteractionPromptProbe()
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

        [MenuItem("Realm of Ashes/Проверить подсказку взаимодействия")]
        private static void Run()
        {
            GameObject host = null;
            try
            {
                RoaHudCanvas.FormatInteractionPrompt("E — поговорить: Старый Клим", false,
                    out string desktopKey, out string desktopAction);
                Require(desktopKey == "E", "desktop key was not preserved");
                Require(desktopAction == "Поговорить: Старый Клим", "desktop action was not formatted");
                RoaHudCanvas.FormatInteractionPrompt("E — открыть", true,
                    out string mobileKey, out string mobileAction);
                Require(mobileKey == "ДЕЙСТВИЕ", "mobile prompt still shows a keyboard key");
                Require(mobileAction == "Открыть", "mobile action was not formatted");

                host = new GameObject("HudInteractionPromptProbe");
                RoaHudCanvas hud = host.AddComponent<RoaHudCanvas>();
                MethodInfo build = typeof(RoaHudCanvas).GetMethod("Build", BindingFlags.Instance | BindingFlags.NonPublic);
                Require(build != null, "HUD builder is missing");
                build.Invoke(hud, null);
                Transform prompt = host.transform.Find("AdaptiveGameplayHud/SafeArea/InteractionPrompt");
                Require(prompt != null, "interaction prompt was not built");
                Require(prompt.GetComponent<CanvasGroup>() != null, "interaction prompt has no fade group");
                Require(((RectTransform)prompt).anchoredPosition.y >= 200f,
                    "interaction prompt overlaps the lower weapon console");
                foreach (Graphic graphic in prompt.GetComponentsInChildren<Graphic>(true))
                    Require(!graphic.raycastTarget, "interaction prompt blocks gameplay input: " + graphic.name);

                Debug.Log("[ПОДСКАЗКА ВЗАИМОДЕЙСТВИЯ] готово: постоянная, адаптивная, не блокирует управление");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПОДСКАЗКА ВЗАИМОДЕЙСТВИЯ] ошибка: " + error.Message);
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
