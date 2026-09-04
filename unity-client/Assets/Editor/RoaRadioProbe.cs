#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Радио Pip-Boy: синтезированных клипов больше нет — без манифеста приёмник
    /// молчит; манифест библиотеки разбирается по маске каналов, курсор
    /// плейлиста ходит по кругу, события сводки раскладываются по каналам,
    /// счётчик угроз считает только враждебные группы, выбор канала сохраняется.
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
                Require(host.GetComponentsInChildren<AudioSource>(true).Length == 1,
                    "у радио должен быть один источник — пластинка, без шума и джинглов");
                Require(!radio.MusicPlaying && !radio.Playing && !radio.LibraryReady && radio.TrackCount == 0,
                    "без манифеста библиотека должна быть пустой, а приёмник — молчать");

                Require(RoaRadio.ChannelForEvent("raid", "Рейд на Свалочный город") == RoaRadio.ChannelSafety,
                    "рейд не попал в канал безопасности");
                Require(RoaRadio.ChannelForEvent("caravan_arrived", "Караван дошёл до станции") == RoaRadio.ChannelBeacon,
                    "караван не попал в поселенческий маяк");
                Require(RoaRadio.ChannelForEvent("relay_signal", "Старый ретранслятор ожил") == RoaRadio.ChannelAsh,
                    "технический пакет не попал в пепельную частоту");

                // Манифест библиотеки (tools/radio-library.py build): каналы по маске,
                // трек без каналов уходит в пепел, курсор плейлиста ходит по кругу.
                var manifestTracks = RoaRadio.ParseManifest(new JObject
                {
                    ["version"] = 1,
                    ["tracks"] = new JArray(
                        new JObject { ["id"] = "a", ["file"] = "a.mp3", ["title"] = "Марш", ["artist"] = "Ансамбль", ["year"] = "1941", ["channels"] = new JArray("safety"), ["duration"] = 180.5 },
                        new JObject { ["id"] = "b", ["file"] = "b.mp3", ["title"] = "Романс", ["channels"] = new JArray("ash") },
                        new JObject { ["id"] = "c", ["file"] = "c.mp3", ["title"] = "Без каналов", ["channels"] = new JArray() },
                        new JObject { ["id"] = "broken", ["title"] = "Без файла" })
                }.ToString());
                Require(manifestTracks.Count == 3, "манифест: ожидалось 3 трека с файлами, получено " + manifestTracks.Count);
                Require(manifestTracks[0].OnChannel(RoaRadio.ChannelSafety) && !manifestTracks[0].OnChannel(RoaRadio.ChannelBeacon)
                        && !manifestTracks[0].OnChannel(RoaRadio.ChannelAsh),
                    "маска каналов трека разобрана неверно");
                Require(manifestTracks[2].OnChannel(RoaRadio.ChannelAsh), "трек без каналов должен уйти в пепельную частоту");
                Require(manifestTracks[0].Caption == "Марш — Ансамбль (1941)", "подпись трека собрана неверно: " + manifestTracks[0].Caption);
                Require(RoaRadio.NextTrackCursor(3, 2, true) == 0 && RoaRadio.NextTrackCursor(3, 0, false) == 0
                        && RoaRadio.NextTrackCursor(1, 0, true) == 0 && RoaRadio.NextTrackCursor(0, 5, true) == 0,
                    "курсор плейлиста не ходит по кругу");
                Require(RoaRadio.Plural(1, "запись", "записи", "записей") == "запись"
                        && RoaRadio.Plural(23, "запись", "записи", "записей") == "записи"
                        && RoaRadio.Plural(111, "запись", "записи", "записей") == "записей",
                    "склонение числа записей");

                radio.SetChannel(RoaRadio.ChannelSafety);
                Require(radio.Channel == RoaRadio.ChannelSafety && radio.StatusLine == "Канал безопасности"
                        && radio.SignalLine == "Настройка на несущую…",
                    "канал безопасности без манифеста должен ждать несущую: " + radio.StatusLine + " / " + radio.SignalLine);
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
                Require(radio.StatusLine.Contains("тревога") && radio.SignalLine.EndsWith("Настройка на несущую…", StringComparison.Ordinal),
                    "статус канала безопасности не отражает угрозу и состояние библиотеки");

                radio.SetChannel(RoaRadio.ChannelBeacon);
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1 && radio.Lines[0].Text.StartsWith("Маяк: ", StringComparison.Ordinal),
                    "поселенческий маяк должен показывать торговые и поселенческие события");
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1, "повторная сводка продублировала строки эфира");

                radio.SetChannel(RoaRadio.ChannelSilence);
                Require(radio.StatusLine == "Приёмник отключён" && string.IsNullOrEmpty(radio.NowPlayingTitle),
                    "«Тишина» не выключила приёмник");

                Debug.Log("[РАДИО] готово: без синтеза, манифест разбирается, каналы разложены, "
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
