#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Радио Pip-Boy: все клипы эфира синтезируются и не пусты, события сводки
    /// раскладываются по каналам, счётчик угроз считает только враждебные
    /// группы, выбор канала сохраняется и восстанавливается.
    /// </summary>
    public static class RoaRadioProbe
    {
        private const string ChannelPrefsKey = "roa.radio.channel.v1";

        [MenuItem("Realm of Ashes/Проверить радио Pip-Boy")]
        public static void Run()
        {
            GameObject host = null;
            bool hadPrefs = PlayerPrefs.HasKey(ChannelPrefsKey);
            int previousChannel = PlayerPrefs.GetInt(ChannelPrefsKey, RoaRadio.ChannelBeacon);
            try
            {
                host = new GameObject("RoaRadioProbe");
                RoaRadio radio = host.AddComponent<RoaRadio>();
                radio.EnsureBuilt();
                Require(radio.GeneratedClipCount == RoaRadio.ExpectedClipCount,
                    "радио сгенерировало " + radio.GeneratedClipCount + " клипов вместо " + RoaRadio.ExpectedClipCount);

                Require(RoaRadio.ChannelForEvent("raid", "Рейд на Свалочный город") == RoaRadio.ChannelSafety,
                    "рейд не попал в канал безопасности");
                Require(RoaRadio.ChannelForEvent("caravan_arrived", "Караван дошёл до станции") == RoaRadio.ChannelBeacon,
                    "караван не попал в поселенческий маяк");
                Require(RoaRadio.ChannelForEvent("relay_signal", "Старый ретранслятор ожил") == RoaRadio.ChannelAsh,
                    "технический пакет не попал в пепельную частоту");
                Require(RoaRadio.BeatInterval(RoaRadio.ChannelSafety, 0) > RoaRadio.BeatInterval(RoaRadio.ChannelSafety, 3),
                    "тревога не учащается с ростом числа угроз");
                Require(RoaRadio.BeatInterval(RoaRadio.ChannelSilence, 0) > 1000f,
                    "«Тишина» продолжает бить ритм");
                for (int note = 0; note < 8; note++)
                    for (float roll = 0f; roll <= 1f; roll += 0.05f)
                    {
                        int next = RoaRadio.NextBeaconNote(note, roll);
                        Require(next >= 0 && next < 8, "нота маяка вышла за пределы гаммы");
                    }

                radio.SetChannel(RoaRadio.ChannelSafety);
                Require(radio.Channel == RoaRadio.ChannelSafety && radio.BedClipName == "RadioCarrierBed",
                    "канал безопасности не переключил подложку на несущую");
                Require(PlayerPrefs.GetInt(ChannelPrefsKey, -1) == RoaRadio.ChannelSafety,
                    "выбор канала не сохранён в PlayerPrefs");

                var wasteland = new JObject
                {
                    ["updatedAt"] = 1000,
                    ["worldHour"] = 132.4,
                    ["stats"] = new JObject { ["caravansArrived"] = 7, ["caravansLost"] = 2 },
                    ["sites"] = new JArray(new JObject { ["id"] = "relayStation" }),
                    ["parties"] = new JArray(
                        new JObject { ["id"] = "p1", ["kind"] = "raiders", ["faction"] = "raiders" },
                        new JObject { ["id"] = "p2", ["kind"] = "caravan", ["faction"] = "scrap_union" },
                        new JObject { ["id"] = "p3", ["kind"] = "monster", ["faction"] = "geckos", ["destroyed"] = true }),
                    ["events"] = new JArray(
                        new JObject { ["id"] = "e1", ["type"] = "raid", ["title"] = "Рейдеры напали на караван", ["hour"] = 131 },
                        new JObject { ["id"] = "e2", ["type"] = "caravan_arrived", ["title"] = "Караван дошёл до станции", ["hour"] = 130 },
                        new JObject { ["id"] = "e3", ["type"] = "relay_signal", ["title"] = "Ретранслятор ожил", ["hour"] = 129 })
                };
                radio.ApplyWasteland(wasteland);
                Require(radio.DangerCount == 1, "счётчик угроз должен считать только живые враждебные группы: " + radio.DangerCount);
                Require(radio.Lines.Count == 1 && radio.Lines[0].Text.StartsWith("Тревога: ", StringComparison.Ordinal),
                    "канал безопасности должен показывать только тревожные события");
                Require(radio.StatusLine.Contains("тревога"), "статус канала безопасности не отражает угрозу");

                radio.SetChannel(RoaRadio.ChannelBeacon);
                radio.ApplyWasteland(wasteland);
                Require(radio.BedClipName == "RadioBeaconPad" && radio.Lines.Count == 1
                        && radio.Lines[0].Text.StartsWith("Маяк: ", StringComparison.Ordinal),
                    "поселенческий маяк должен показывать торговые и поселенческие события");
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1, "повторная сводка продублировала строки эфира");

                radio.SetChannel(RoaRadio.ChannelSilence);
                Require(string.IsNullOrEmpty(radio.BedClipName) && radio.StatusLine == "Приёмник отключён",
                    "«Тишина» не выключила приёмник");

                Debug.Log("[РАДИО] готово: " + radio.GeneratedClipCount + " клипов эфира, каналы разложены, "
                    + "угрозы=" + radio.DangerCount + ", выбор канала сохраняется.");
            }
            catch (Exception error)
            {
                Debug.LogError("[РАДИО] ошибка: " + error.Message);
            }
            finally
            {
                if (hadPrefs) PlayerPrefs.SetInt(ChannelPrefsKey, previousChannel);
                else PlayerPrefs.DeleteKey(ChannelPrefsKey);
                PlayerPrefs.Save();
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
