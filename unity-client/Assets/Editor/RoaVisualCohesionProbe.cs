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
            RoaGlobalMap.StrategicVisualProfile profile = RoaGlobalMap.StrategicProfile(160f);
            Require(profile.FogStart > 160f && profile.FogEnd > profile.FogStart + 35f,
                "strategic edge fog reaches the playable map centre");
            Require(ColorDistance(profile.CameraBackground, profile.FogColor) < 0.04f,
                "camera void and strategic fog do not form one visual field");
            Require(profile.AmbientSky.maxColorComponent > profile.AmbientGround.maxColorComponent * 2f
                    && profile.ReflectionIntensity < 0.4f,
                "strategic miniatures lost readable top-to-ground contrast");

            float halfShown = RoaGlobalMap.PresentationVisibility(0f, true, 0.09f);
            float fullyShown = RoaGlobalMap.PresentationVisibility(0f, true, 0.18f);
            float halfHidden = RoaGlobalMap.PresentationVisibility(1f, false, 0.09f);
            Require(halfShown > 0.45f && halfShown < 0.55f
                    && Mathf.Approximately(fullyShown, 1f)
                    && halfHidden > 0.45f && halfHidden < 0.55f,
                "zoom hierarchy no longer cross-fades symmetrically");
            Require(RoaGlobalMap.PresentationVisibilityScale(0f, 1f) < 0.8f
                    && Mathf.Approximately(
                        RoaGlobalMap.PresentationVisibilityScale(1f, 1f), 1f),
                "map layers do not settle from quiet to authored scale");

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
            GameObject mapHost = null;
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

                mapHost = new GameObject("VisualCohesion49_Map");
                RoaGlobalMapCanvas map = mapHost.AddComponent<RoaGlobalMapCanvas>();
                MethodInfo ensureMap = typeof(RoaGlobalMapCanvas).GetMethod(
                    "EnsureBuilt", PrivateInstance);
                Require(ensureMap != null, "global-map Canvas build hook is missing");
                ensureMap.Invoke(map, null);
                Canvas mapCanvas = mapHost.GetComponentInChildren<Canvas>(true);
                Text[] mapTexts = mapHost.GetComponentsInChildren<Text>(true);
                Require(mapCanvas != null && mapCanvas.pixelPerfect
                        && mapTexts.Length >= 12
                        && mapTexts.All(text => text.GetComponent<Shadow>() != null),
                    "global-map typography is not consistently protected from the world image");
            }
            finally
            {
                if (mapHost != null) UnityEngine.Object.DestroyImmediate(mapHost);
                if (hudHost != null) UnityEngine.Object.DestroyImmediate(hudHost);
            }

            Debug.Log("[VISUAL COHESION 4.9] готово: карта=мягкие уровни+краевой туман, "
                + "HUD=контекстная громкость, текст=pixel-perfect+1px shadow.");
        }

        private static float ColorDistance(Color a, Color b)
        {
            return new Vector3(a.r - b.r, a.g - b.g, a.b - b.b).magnitude;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("[VISUAL COHESION 4.9] " + message);
        }
    }
}
#endif
