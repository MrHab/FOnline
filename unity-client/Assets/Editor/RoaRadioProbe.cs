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
    /// молчит; манифест библиотеки разбирается по маске каналов, общее расписание
    /// детерминировано и ходит по кругу, события сводки раскладываются по каналам,
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
                // Общее расписание: порядок станции детерминирован seed'ом и одинаков при
                // повторном построении, слоты идут подряд с паузой, время ходит по кругу.
                var scheduleTracks = RoaRadio.ParseManifest(new JObject
                {
                    ["tracks"] = new JArray(
                        new JObject { ["id"] = "s1", ["file"] = "s1.mp3", ["title"] = "Первая", ["channels"] = new JArray("safety"), ["duration"] = 100 },
                        new JObject { ["id"] = "b1", ["file"] = "b1.mp3", ["title"] = "Маяк", ["channels"] = new JArray("beacon"), ["duration"] = 50 },
                        new JObject { ["id"] = "s2", ["file"] = "s2.mp3", ["title"] = "Вторая", ["channels"] = new JArray("safety"), ["duration"] = 60 },
                        new JObject { ["id"] = "s3", ["file"] = "s3.mp3", ["title"] = "Третья", ["channels"] = new JArray("safety") })
                }.ToString());
                var order = RoaRadio.BuildOrder(scheduleTracks, RoaRadio.ChannelSafety, 12345);
                var orderAgain = RoaRadio.BuildOrder(scheduleTracks, RoaRadio.ChannelSafety, 12345);
                Require(order.Count == 3 && !order.Contains(1) && string.Join(",", order) == string.Join(",", orderAgain),
                    "порядок станции должен содержать только её треки и повторяться при том же seed: " + string.Join(",", order));
                Require(string.Join(",", RoaRadio.BuildOrder(scheduleTracks, RoaRadio.ChannelBeacon, 12345)) == "1",
                    "маяк должен получить единственный свой трек");
                double cycle;
                double[] starts = RoaRadio.BuildStarts(scheduleTracks, order, out cycle);
                double expectedCycle = 100 + 60 + RoaRadio.FallbackDuration + 3 * RoaRadio.GapSeconds;
                Require(Math.Abs(cycle - expectedCycle) < 1e-6 && starts[0] == 0d
                        && Math.Abs(starts[1] - (scheduleTracks[order[0]].SlotDuration + RoaRadio.GapSeconds)) < 1e-6,
                    "слоты расписания должны идти подряд с паузой: цикл " + cycle + ", ожидалось " + expectedCycle);
                double offset;
                Require(RoaRadio.SlotAt(0d, cycle, starts, out offset) == 0 && offset == 0d, "нулевое время — начало первого слота");
                Require(RoaRadio.SlotAt(cycle + 7d, cycle, starts, out offset) == 0 && Math.Abs(offset - 7d) < 1e-6,
                    "время должно ходить по кругу цикла");
                Require(RoaRadio.SlotAt(starts[1] + 0.5d, cycle, starts, out offset) == 1 && Math.Abs(offset - 0.5d) < 1e-6,
                    "второй слот начинается со своего старта");
                Require(RoaRadio.SlotAt(starts[1] + scheduleTracks[order[1]].SlotDuration + 1d, cycle, starts, out offset) == 1
                        && offset >= scheduleTracks[order[1]].SlotDuration,
                    "смещение за длительностью записи — пауза между пластинками");
                Require(RoaRadio.SlotAt(-1d, cycle, starts, out offset) == 2 && RoaRadio.SlotAt(5d, 0d, new double[0], out offset) == -1,
                    "отрицательное время уходит в конец цикла, пустое расписание даёт -1");
                int seed; double epoch;
                RoaRadio.ReadScheduleSettings("{\"scheduleSeed\": 777, \"scheduleEpoch\": 1767225600}", out seed, out epoch);
                Require(seed == 777 && epoch == 1767225600d, "seed и эпоха расписания из манифеста");
                RoaRadio.ReadScheduleSettings("{}", out seed, out epoch);
                Require(seed == 0 && epoch == RoaRadio.DefaultScheduleEpoch, "без полей — эпоха по умолчанию");
                double clockOffset = RoaRadio.ClockOffsetFromDateHeader("Sat, 05 Sep 2026 00:00:10 GMT", 1788566400d);
                Require(Math.Abs(clockOffset - 10d) < 1e-6, "поправка часов из заголовка Date: " + clockOffset);
                Require(RoaRadio.ClockOffsetFromDateHeader("", 1d) == 0d && RoaRadio.ClockOffsetFromDateHeader("мусор", 1d) == 0d,
                    "без заголовка Date поправка нулевая");
                Require(RoaRadio.Plural(1, "запись", "записи", "записей") == "запись"
                        && RoaRadio.Plural(23, "запись", "записи", "записей") == "записи"
                        && RoaRadio.Plural(111, "запись", "записи", "записей") == "записей",
                    "склонение числа записей");

                radio.SetChannel(RoaRadio.ChannelSafety);
                Require(radio.Channel == RoaRadio.ChannelSafety && radio.StatusLine == "Сводка Тракта"
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
                // Живая сводка называет канал так же, как вкладка: после переименования
                // каналов она ещё неделю писала «Канал безопасности» под «Сводкой Тракта».
                Require(radio.StatusLine.StartsWith(RoaPipboy.RadioTitles[RoaRadio.ChannelSafety] + " · ", StringComparison.Ordinal),
                    "живая сводка называет канал не так, как вкладка: " + radio.StatusLine);

                radio.SetChannel(RoaRadio.ChannelAsh);
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1 && radio.Lines[0].Text.StartsWith("Пакет данных: ", StringComparison.Ordinal),
                    "шумовой канал должен показывать только прочие события");
                Require(radio.StatusLine.StartsWith(RoaPipboy.RadioTitles[RoaRadio.ChannelAsh] + " · ", StringComparison.Ordinal),
                    "живая сводка называет канал не так, как вкладка: " + radio.StatusLine);

                radio.SetChannel(RoaRadio.ChannelBeacon);
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1 && radio.Lines[0].Text.StartsWith("Маяк: ", StringComparison.Ordinal),
                    "поселенческий маяк должен показывать торговые и поселенческие события");
                Require(radio.StatusLine.StartsWith(RoaPipboy.RadioTitles[RoaRadio.ChannelBeacon] + " · ", StringComparison.Ordinal),
                    "живая сводка называет канал не так, как вкладка: " + radio.StatusLine);
                radio.ApplyWasteland(wasteland);
                Require(radio.Lines.Count == 1, "повторная сводка продублировала строки эфира");

                radio.SetChannel(RoaRadio.ChannelSilence);
                Require(radio.StatusLine == "Приёмник отключён" && string.IsNullOrEmpty(radio.NowPlayingTitle),
                    "«Тишина» не выключила приёмник");

                Debug.Log("[РАДИО] готово: без синтеза, манифест и общее расписание разбираются, каналы разложены, "
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
