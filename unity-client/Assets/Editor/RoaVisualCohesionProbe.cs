#if UNITY_EDITOR
using System;
using System.Linq;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaVisualCohesionProbe
    {
        private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

        [MenuItem("Realm of Ashes/Проверить Visual Cohesion 4.9")]
        public static void Run()
        {
            Require(RoaHudCanvas.FocusLayerAlpha(RoaHudCanvas.HudFocusMode.Combat,
                        RoaHudCanvas.HudVisualLayer.Minimap)
                    > RoaHudCanvas.FocusLayerAlpha(RoaHudCanvas.HudFocusMode.Activity,
                        RoaHudCanvas.HudVisualLayer.Minimap)
                    && RoaHudCanvas.FocusLayerAlpha(RoaHudCanvas.HudFocusMode.Combat,
                        RoaHudCanvas.HudVisualLayer.WeaponConsole)
                    > RoaHudCanvas.FocusLayerAlpha(RoaHudCanvas.HudFocusMode.Exploration,
                        RoaHudCanvas.HudVisualLayer.WeaponConsole),
                "HUD context no longer controls visual emphasis");

            GameObject hudHost = null;
            try
            {
                hudHost = new GameObject("VisualCohesion49_Hud");
                RoaHudCanvas hud = hudHost.AddComponent<RoaHudCanvas>();
                MethodInfo buildHud = typeof(RoaHudCanvas).GetMethod("Build", PrivateInstance);
                Require(buildHud != null, "adaptive HUD build hook is missing");
                buildHud.Invoke(hud, null);
                Canvas hudCanvas = hudHost.GetComponentInChildren<Canvas>(true);
                RectTransform minimap = hudHost.transform.Find(
                    "AdaptiveGameplayHud/SafeArea/Minimap") as RectTransform;
                RectTransform quickbar = hudHost.transform.Find(
                    "AdaptiveGameplayHud/SafeArea/Quickbar") as RectTransform;
                Text[] hudTexts = hudHost.GetComponentsInChildren<Text>(true);
                Require(hudCanvas != null && hudCanvas.pixelPerfect
                        && minimap?.GetComponent<CanvasGroup>() != null
                        && quickbar?.GetComponent<CanvasGroup>() != null,
                    "HUD focus layers are not pixel-perfect Canvas groups");
                Require(hudTexts.Length >= 20
                        && hudTexts.All(text => text.GetComponent<Shadow>() != null),
                    "small HUD text is missing the one-pixel contrast shadow");
            }
            finally
            {
                if (hudHost != null) UnityEngine.Object.DestroyImmediate(hudHost);
            }

            Debug.Log("[VISUAL COHESION 4.9] готово: HUD=контекстная громкость, текст=pixel-perfect+1px shadow.");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("[VISUAL COHESION 4.9] " + message);
        }
    }
}
#endif
