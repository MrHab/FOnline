#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaEncounterLayoutProbe
    {
        [MenuItem("Realm of Ashes/Проверить Encounter Layout 5.4")]
        public static void Run()
        {
            try
            {
                JObject first = Activity("north", 1);
                JObject second = Activity("east", 2);
                JObject lane = RoaWorldActivityCanvas.ActiveEncounterLane(second);
                Require(lane?["label"]?.ToString() == "ВОСТОК",
                    "HUD не разрешает активную серверную линию подхода");
                Require(RoaWorldActivityCanvas.EncounterStatusText(second) == "ВОЛНА 2/3 · ВОСТОК",
                    "номер волны и направление атаки нечитаемы");
                Require(RoaWorldActivityCanvas.MissionDirectorTransitionMessage(first, second)
                    .Contains("новое направление атаки"),
                    "смена линии подхода не объявляется игроку");
                Require((int)RoaMinimap.MarkerKind.Threat != (int)RoaMinimap.MarkerKind.Objective,
                    "угроза на миникарте неотличима от мирной цели");

                var zoneObject = new GameObject("EncounterZoneProbe");
                var zone = zoneObject.AddComponent<RoaActivityZoneMarker>();
                zone.Configure(18f, new Color(0.95f, 0.75f, 0.25f));
                Require(Mathf.Approximately(zone.Radius, 18f) && zone.SegmentCount == 72
                    && zoneObject.GetComponentInChildren<Collider>(true) == null,
                    "граница района неточна либо вмешивается в игровую коллизию");
                UnityEngine.Object.DestroyImmediate(zoneObject);

                Debug.Log("[ENCOUNTER LAYOUT 5.4] готово: волны имеют направление, HUD и карту угрозы.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ENCOUNTER LAYOUT 5.4] ошибка: " + error.Message);
            }
        }

        private static JObject Activity(string activeLaneId, int wave)
        {
            return new JObject
            {
                ["id"] = "defense",
                ["kind"] = "outpost_defense",
                ["phase"] = "defending",
                ["status"] = "active",
                ["encounter"] = new JObject
                {
                    ["activeLaneId"] = activeLaneId,
                    ["waveNumber"] = wave,
                    ["waveCount"] = 3,
                    ["lanes"] = new JArray
                    {
                        new JObject { ["id"] = "north", ["label"] = "СЕВЕР", ["x"] = 0f, ["z"] = -20f },
                        new JObject { ["id"] = "east", ["label"] = "ВОСТОК", ["x"] = 20f, ["z"] = 0f }
                    }
                },
                ["director"] = new JObject { ["warning"] = string.Empty }
            };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
