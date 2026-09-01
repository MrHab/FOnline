#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaMissionDirectorProbe
    {
        [MenuItem("Realm of Ashes/Проверить Mission Director 5.3")]
        public static void Run()
        {
            try
            {
                JObject planning = Activity("operation", "assault_diversion", "planning");
                JObject assault = Activity("operation", "assault_diversion", "assaulting");
                Require(RoaWorldActivityCanvas.MissionDirectorTransitionMessage(planning, assault)
                    .Contains("ШТУРМ"),
                    "выбор штурма не получает однозначное объявление нового этапа");

                JObject extraction = Activity("operation", "assault_diversion", "extraction");
                Require(RoaWorldActivityCanvas.MissionDirectorTransitionMessage(assault, extraction)
                    .Contains("ЭВАКУАЦИИ"),
                    "открытие эвакуации не объясняет финальное действие");

                JObject recovered = Activity("operation", "assault_diversion", "assaulting");
                recovered["director"] = new JObject
                {
                    ["warning"] = "target_recovered"
                };
                Require(RoaWorldActivityCanvas.MissionDirectorTransitionMessage(assault, recovered)
                    .Contains("ВОССТАНОВЛЕНА"),
                    "восстановленная сервером цель остаётся невидимой игроку");

                JObject unrelated = Activity("another_operation", "assault_diversion", "planning");
                Require(string.IsNullOrEmpty(RoaWorldActivityCanvas
                    .MissionDirectorTransitionMessage(planning, unrelated)),
                    "новая активность ошибочно получает переход от предыдущей миссии");

                Require(RoaWorldActivityCanvas.MissionTimeWarningLevel(61f) == 0
                    && RoaWorldActivityCanvas.MissionTimeWarningLevel(60f) == 1
                    && RoaWorldActivityCanvas.MissionTimeWarningLevel(15f) == 2
                    && RoaWorldActivityCanvas.MissionTimeWarningMessage(2).Contains("15 СЕКУНД"),
                    "предупреждения последней минуты имеют неверные границы");

                Debug.Log("[MISSION DIRECTOR 5.3] готово: этапы, восстановление цели и финальный таймер читаемы.");
            }
            catch (Exception error)
            {
                Debug.LogError("[MISSION DIRECTOR 5.3] ошибка: " + error.Message);
            }
        }

        private static JObject Activity(string id, string kind, string phase)
        {
            return new JObject
            {
                ["id"] = id,
                ["kind"] = kind,
                ["phase"] = phase,
                ["status"] = phase == "extraction" ? "extracting" : "active",
                ["extractionOpen"] = phase == "extraction",
                ["director"] = new JObject
                {
                    ["warning"] = string.Empty
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
