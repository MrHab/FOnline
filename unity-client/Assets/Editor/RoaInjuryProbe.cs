using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Живая проверка формул и визуального слоя травм.</summary>
    public static class RoaInjuryProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить травмы";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            var host = new GameObject("InjuryProbe");
            try
            {
                var viewGo = new GameObject("View");
                viewGo.transform.SetParent(host.transform, false);
                var view = viewGo.AddComponent<RoaCharacterView>();
                var controller = host.AddComponent<RoaPlayerController>();
                controller.View = view;

                var self = new JObject
                {
                    ["special"] = new JObject { ["agi"] = 5, ["per"] = 5 },
                    ["equipmentRuntime"] = new JObject { ["boots"] = "ui_scoutBoots_12_34" },
                    ["injuries"] = new JObject
                    {
                        ["brokenArm"] = true,
                        ["brokenLeg"] = true,
                        ["concussion"] = true,
                        ["infection"] = true
                    }
                };

                controller.ApplySpecial(self);
                float expectedSpeed = (5f + 0.34f) * 0.68f * 0.92f;
                if (Mathf.Abs(controller.Speed - expectedSpeed) > 0.0001f)
                    throw new InvalidOperationException("Скорость " + controller.Speed
                        + ", ожидалось " + expectedSpeed);
                if (!controller.HasBrokenArm || !controller.HasBrokenLeg
                    || !controller.HasConcussion || !controller.HasInfection)
                    throw new InvalidOperationException("Контроллер потерял часть авторитетных травм.");

                var fog = host.AddComponent<RoaFogOfWar>();
                fog.Perception = controller.Perception;
                fog.Vigilance = controller.Vigilance;
                int healthyRadius = fog.ComputeRadius(false, false, false);
                int injuredRadius = fog.ComputeRadius(false, true, true);
                if (healthyRadius != 5 || injuredRadius != 3)
                    throw new InvalidOperationException("Радиус " + healthyRadius + "/" + injuredRadius
                        + ", ожидалось 5/3.");

                Transform indicators = viewGo.transform.Find("InjuryIndicators");
                int visibleMarkers = 0;
                if (indicators != null)
                    for (int i = 0; i < indicators.childCount; i++)
                        if (indicators.GetChild(i).gameObject.activeSelf) visibleMarkers++;
                if (visibleMarkers != 4)
                    throw new InvalidOperationException("Видимых маркеров " + visibleMarkers + ", ожидалось 4.");

                Debug.Log("[ТРАВМЫ] готово: скорость=" + controller.Speed.ToString("0.000")
                    + ", обзор=" + healthyRadius + "→" + injuredRadius
                    + ", маркеров=" + visibleMarkers);
            }
            catch (Exception error)
            {
                Debug.LogError("[ТРАВМЫ] ошибка: " + error.Message);
            }
            finally
            {
                UnityEngine.Object.Destroy(host);
            }
        }

        [MenuItem(MenuPath, true)]
        private static bool ValidateRun()
        {
            return EditorApplication.isPlaying;
        }
    }
}
