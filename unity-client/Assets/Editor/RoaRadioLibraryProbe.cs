#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Живая проверка библиотеки радио: с запущенного сервера (BaseUrl из
    /// ROA_UNITY_BASE_URL или 127.0.0.1:3000) берётся /radio/manifest.json,
    /// разбирается тем же ParseManifest, что и клиент, и один трек середины
    /// списка декодируется через UnityWebRequestMultimedia (MPEG) — так
    /// ловятся битые MP3 и сломанная раздача до запуска игры. Запросы ждут
    /// через EditorApplication.update, а не блокируют главный поток: иначе
    /// в несфокусированном редакторе UnityWebRequest не завершается.
    /// Итог — в консоли строкой [РАДИО·БИБЛИОТЕКА].
    /// </summary>
    public static class RoaRadioLibraryProbe
    {
        private const float TimeoutSeconds = 60f;

        private static UnityWebRequest _request;
        private static double _deadline;
        private static Action<UnityWebRequest> _onDone;

        [MenuItem("Realm of Ashes/Проверить библиотеку радио (сервер)")]
        public static void Run()
        {
            if (_request != null)
            {
                Debug.LogWarning("[РАДИО·БИБЛИОТЕКА] проверка уже идёт");
                return;
            }
            string baseUrl = (Environment.GetEnvironmentVariable("ROA_UNITY_BASE_URL") ?? "http://127.0.0.1:3000").TrimEnd('/');
            Send(UnityWebRequest.Get(baseUrl + RoaRadio.ManifestPath), manifest =>
            {
                Require(manifest.result == UnityWebRequest.Result.Success, "манифест не получен: " + manifest.error);
                List<RoaRadio.Track> tracks = RoaRadio.ParseManifest(manifest.downloadHandler.text);
                Require(tracks.Count > 0, "манифест пуст");
                int beacon = 0, ash = 0, safety = 0, multi = 0;
                foreach (RoaRadio.Track t in tracks)
                {
                    int stations = 0;
                    if (t.OnChannel(RoaRadio.ChannelBeacon)) { beacon++; stations++; }
                    if (t.OnChannel(RoaRadio.ChannelAsh)) { ash++; stations++; }
                    if (t.OnChannel(RoaRadio.ChannelSafety)) { safety++; stations++; }
                    if (stations != 1) multi++;
                }
                Require(beacon > 0 && ash > 0 && safety > 0, "какой-то канал остался без треков");
                Require(multi == 0, "у " + multi + " треков не одна станция — каналы должны звучать по-разному");

                // Общее расписание: что сейчас в эфире каждой станции по серверным часам.
                int seed; double epoch;
                RoaRadio.ReadScheduleSettings(manifest.downloadHandler.text, out seed, out epoch);
                double clockOffset = RoaRadio.ClockOffsetFromDateHeader(manifest.GetResponseHeader("Date"),
                    (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds);
                double now = (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds + clockOffset - epoch;
                var onAir = new System.Text.StringBuilder();
                for (int channel = RoaRadio.ChannelBeacon; channel <= RoaRadio.ChannelSafety; channel++)
                {
                    List<int> order = RoaRadio.BuildOrder(tracks, channel, seed);
                    double cycle;
                    double[] starts = RoaRadio.BuildStarts(tracks, order, out cycle);
                    double offset;
                    int slot = RoaRadio.SlotAt(now, cycle, starts, out offset);
                    Require(slot >= 0 && slot < order.Count, "расписание канала " + channel + " не дало слот");
                    RoaRadio.Track current = tracks[order[slot]];
                    onAir.Append("\n  ").Append(RoaPipboy.RadioTitles[channel]).Append(": ").Append(current.Caption)
                        .Append(offset >= current.SlotDuration ? " (пауза)" : " @ " + offset.ToString("F0") + " с")
                        .Append(", цикл ").Append((cycle / 3600d).ToString("F1")).Append(" ч");
                }
                Debug.Log("[РАДИО·БИБЛИОТЕКА] в эфире сейчас (seed " + seed + ", поправка часов "
                    + clockOffset.ToString("F1") + " с):" + onAir);

                RoaRadio.Track track = tracks[tracks.Count / 2];
                string url = baseUrl + "/radio/" + UnityWebRequest.EscapeURL(track.File).Replace("+", "%20");
                Send(UnityWebRequestMultimedia.GetAudioClip(url, AudioType.MPEG), audio =>
                {
                    Require(audio.result == UnityWebRequest.Result.Success, "трек не скачан: " + audio.error + " " + url);
                    AudioClip clip = DownloadHandlerAudioClip.GetContent(audio);
                    Require(clip != null && clip.length > 5f, "трек не декодирован: " + track.File);
                    Require(track.Duration <= 0f || Mathf.Abs(clip.length - track.Duration) < 3f,
                        "длительность в манифесте " + track.Duration + " не совпадает с клипом " + clip.length);
                    Debug.Log("[РАДИО·БИБЛИОТЕКА] готово: " + tracks.Count + " треков (маяк " + beacon + ", пепел " + ash
                        + ", безопасность " + safety + ", по одной станции у каждого); " + track.Caption + " — "
                        + clip.length.ToString("F1") + " с, " + clip.frequency + " Гц, каналов " + clip.channels);
                    UnityEngine.Object.DestroyImmediate(clip);
                });
            });
        }

        private static void Send(UnityWebRequest request, Action<UnityWebRequest> onDone)
        {
            _request = request;
            _onDone = onDone;
            _deadline = EditorApplication.timeSinceStartup + TimeoutSeconds;
            _request.SendWebRequest();
            EditorApplication.update -= Pump;
            EditorApplication.update += Pump;
        }

        private static void Pump()
        {
            if (_request == null)
            {
                EditorApplication.update -= Pump;
                return;
            }
            bool timedOut = EditorApplication.timeSinceStartup > _deadline;
            if (!_request.isDone && !timedOut) return;
            EditorApplication.update -= Pump;
            UnityWebRequest request = _request;
            Action<UnityWebRequest> onDone = _onDone;
            _request = null;
            _onDone = null;
            try
            {
                Require(!timedOut, "таймаут запроса " + request.url);
                onDone(request);
            }
            catch (Exception error)
            {
                Debug.LogError("[РАДИО·БИБЛИОТЕКА] ошибка: " + error.Message);
            }
            finally
            {
                request.Dispose();
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
