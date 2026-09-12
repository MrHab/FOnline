using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Рабочее радио Pip-Boy. Четыре канала браузерной версии остаются теми же,
    /// но выбранный канал крутит настоящие пластинки: библиотеку собирает
    /// tools/radio-library.py (public/radio/manifest.json + MP3), у каждого
    /// трека ровно одна станция, поэтому каналы звучат по-разному —
    /// маяк: народное и бытовое; пепел: романсы, арии, дореволюционные записи;
    /// безопасность: марши и военные ансамбли.
    ///
    /// Эфир общий для всех игроков: у каждой станции детерминированный порядок
    /// пластинок (seed из манифеста) и непрерывный цикл от общей эпохи, а
    /// текущая запись и смещение в ней считаются от серверных часов (заголовок
    /// Date ответа с манифестом). Поэтому переключение канала попадает в
    /// середину идущей пластинки, как на настоящем радио, и все слышат одно и
    /// то же. Синтезированных звуков нет: без манифеста приёмник молчит и
    /// повторяет запрос раз в минуту. Текстовая лента «эфира» строится из
    /// публичной сводки пустоши (/api/wasteland). Выбор канала переживает
    /// перезапуск клиента. Радио — чистая презентация: сервер о нём не знает,
    /// игровых эффектов нет.
    /// </summary>
    public sealed class RoaRadio : MonoBehaviour
    {
        public const int ChannelBeacon = 0;
        public const int ChannelAsh = 1;
        public const int ChannelSafety = 2;
        public const int ChannelSilence = 3;

        /// <summary>Манифест библиотеки (tools/radio-library.py build → public/radio/manifest.json).</summary>
        public const string ManifestPath = "/radio/manifest.json";
        /// <summary>Пауза тишины между пластинками в общем расписании.</summary>
        public const double GapSeconds = 2.5d;
        /// <summary>Общая эпоха расписания, если манифест её не задал: 2026-01-01T00:00:00Z.</summary>
        public const double DefaultScheduleEpoch = 1767225600d;
        /// <summary>Длина слота для записи без известной длительности.</summary>
        public const double FallbackDuration = 180d;

        private const string ChannelPrefsKey = "roa.radio.channel.v1";
        private const float WorldRefreshSeconds = 20f;
        private const int MaxBroadcastLines = 6;
        private const float MusicVolume = 0.55f;
        private const float MusicFadeSpeed = 0.6f;
        private const float ManifestRetrySeconds = 60f;
        private const double PreloadLeadSeconds = 8d;
        private const double DriftToleranceSeconds = 1.2d;
        private const float DriftCheckSeconds = 2f;

        private static readonly DateTime UnixEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private static readonly string[] HostileFactions =
        {
            "raiders", "mutants", "super_mutants", "ghouls", "radscorpions",
            "mutant_ants", "geckos", "ash_wolves", "monsters", "monster"
        };

        public static RoaRadio Active { get; private set; }

        public struct Broadcast
        {
            public string Stamp;
            public string Text;
        }

        public struct Track
        {
            public string Id;
            public string File;
            public string Title;
            public string Artist;
            public string Year;
            public string Source;
            public string License;
            public int ChannelMask;
            public float Duration;

            public bool OnChannel(int channel) { return (ChannelMask & (1 << channel)) != 0; }
            /// <summary>Длительность в расписании: известная или запасная.</summary>
            public double SlotDuration { get { return Duration > 1f ? Duration : FallbackDuration; } }
            public string Caption
            {
                get
                {
                    string caption = Title;
                    if (!string.IsNullOrEmpty(Artist)) caption += " — " + Artist;
                    if (!string.IsNullOrEmpty(Year)) caption += " (" + Year + ")";
                    return caption;
                }
            }
        }

        public RoaPipboy Pipboy;
        public RoaGameBootstrap Bootstrap;
        /// <summary>Адрес сервера; пустой — берётся из Pip-Boy (тот же BaseUrl, что у API).</summary>
        public string BaseUrl;

        public int Channel { get; private set; }
        public int DangerCount { get; private set; }
        public IReadOnlyList<Broadcast> Lines { get { return _lines; } }
        public string StatusLine { get; private set; } = "Приёмник отключён";
        public string SignalLine { get; private set; } = string.Empty;
        public bool LibraryReady { get; private set; }
        public int TrackCount { get { return _tracks.Count; } }
        /// <summary>Сколько треков библиотеки на текущем канале.</summary>
        public int ChannelTrackCount { get { return _order.Count; } }
        public string NowPlayingTitle { get; private set; } = string.Empty;
        public string NextUpTitle { get; private set; } = string.Empty;
        public bool MusicPlaying { get { return _music != null && _music.isPlaying && _music.clip != null; } }
        public bool Playing { get { return MusicPlaying && _music.volume > 0.001f; } }
        /// <summary>Поправка местных часов к серверным, секунды (из заголовка Date манифеста).</summary>
        public double ClockOffsetSeconds { get; private set; }
        public int ScheduleSeed { get; private set; }
        public double ScheduleEpoch { get; private set; } = DefaultScheduleEpoch;

        private readonly List<Broadcast> _lines = new List<Broadcast>();
        private readonly HashSet<string> _seenEventKeys = new HashSet<string>();
        private readonly List<Track> _tracks = new List<Track>();
        private List<int> _order = new List<int>();
        private double[] _starts = new double[0];
        private double _cycle;
        private AudioSource _music;
        private AudioClip _nextClip;
        private int _nextSlot = -1;
        private int _currentSlot = -1;
        private bool _hasCurrentTrack;
        private bool _loadingTrack;
        private bool _manifestRequested;
        private bool _manifestMissing;
        private bool _built;
        private float _nextManifestAttemptAt;
        private float _nextLoadAttemptAt;
        private float _nextDriftCheckAt;
        private float _nextWorldRefreshAt;
        private double _appliedWorldUpdatedAt = -1d;
        private int _trackFailures;
        private int _trackRequest;

        private void Awake()
        {
            if (Active != null && Active != this)
            {
                Destroy(this);
                return;
            }
            Active = this;
            EnsureBuilt();
            Channel = ClampChannel(PlayerPrefs.GetInt(ChannelPrefsKey, ChannelBeacon));
            ApplyChannelPresentation();
        }

        private void Start()
        {
            if (Pipboy != null) Pipboy.RadioChannel = Channel;
        }

        private void OnDestroy()
        {
            if (Active == this) Active = null;
            StopMusic();
        }

        /// <summary>Источник звука создаётся один раз — пробы вызывают это без Awake.</summary>
        public void EnsureBuilt()
        {
            if (_built) return;
            _built = true;
            var go = new GameObject("RadioMusic");
            go.transform.SetParent(transform, false);
            _music = go.AddComponent<AudioSource>();
            _music.playOnAwake = false;
            _music.loop = false;
            _music.spatialBlend = 0f;
            _music.dopplerLevel = 0f;
            _music.ignoreListenerPause = true;
        }

        public void SetChannel(int channel)
        {
            int next = ClampChannel(channel);
            if (next == Channel && _hasCurrentTrack) return;
            Channel = next;
            PlayerPrefs.SetInt(ChannelPrefsKey, Channel);
            PlayerPrefs.Save();
            if (Pipboy != null && Pipboy.RadioChannel != Channel) Pipboy.RadioChannel = Channel;
            _lines.Clear();
            _seenEventKeys.Clear();
            _appliedWorldUpdatedAt = -1d;
            StopMusic();
            RebuildSchedule();
            ApplyChannelPresentation();
            if (Pipboy != null && Pipboy.Wasteland != null) ApplyWasteland(Pipboy.Wasteland);
        }

        private void Update()
        {
            if (Pipboy != null && Pipboy.RadioChannel != Channel) SetChannel(Pipboy.RadioChannel);

            bool inGame = Bootstrap == null || Bootstrap.InGame;
            bool live = inGame && Channel != ChannelSilence;
            float dt = Mathf.Max(0.001f, Time.unscaledDeltaTime);
            if (_music != null)
            {
                float musicTarget = live && MusicPlaying ? MusicVolume : 0f;
                _music.volume = Mathf.MoveTowards(_music.volume, musicTarget, dt * MusicFadeSpeed);
            }
            if (!live)
            {
                if (MusicPlaying && _music.volume <= 0.001f) StopMusic();
                return;
            }

            if (Pipboy != null && Time.unscaledTime >= _nextWorldRefreshAt)
            {
                _nextWorldRefreshAt = Time.unscaledTime + WorldRefreshSeconds;
                Pipboy.EnsureWorldData();
            }
            JObject wasteland = Pipboy != null ? Pipboy.Wasteland : null;
            if (wasteland != null)
            {
                double updatedAt = Number(wasteland["updatedAt"]);
                if (updatedAt != _appliedWorldUpdatedAt) ApplyWasteland(wasteland);
            }

            UpdateLibrary();
        }

        // ------------------------------------------------------------------
        // Общее расписание эфира
        // ------------------------------------------------------------------

        /// <summary>Секунды от эпохи расписания по серверным часам.</summary>
        public double ScheduleNow()
        {
            return UnixNow() + ClockOffsetSeconds - ScheduleEpoch;
        }

        private static double UnixNow()
        {
            return (DateTime.UtcNow - UnixEpoch).TotalSeconds;
        }

        /// <summary>
        /// Порядок пластинок станции: индексы треков канала, перемешанные
        /// детерминированно по seed манифеста и номеру канала — одинаково у всех клиентов.
        /// </summary>
        public static List<int> BuildOrder(IReadOnlyList<Track> tracks, int channel, int seed)
        {
            var order = new List<int>();
            for (int i = 0; i < tracks.Count; i++)
                if (tracks[i].OnChannel(channel)) order.Add(i);
            uint state = unchecked((uint)seed * 2654435761u) ^ unchecked((uint)(channel + 1) * 0x9e3779b9u) ^ 0x2f6b1a3du;
            for (int i = order.Count - 1; i > 0; i--)
            {
                state = state * 1664525u + 1013904223u;
                int j = (int)(((state >> 8) & 0xffffffu) % (uint)(i + 1));
                int swap = order[i];
                order[i] = order[j];
                order[j] = swap;
            }
            return order;
        }

        /// <summary>Начала слотов в цикле; слот = длительность записи + пауза; возвращает длину цикла.</summary>
        public static double[] BuildStarts(IReadOnlyList<Track> tracks, IReadOnlyList<int> order, out double cycle)
        {
            var starts = new double[order.Count];
            double at = 0d;
            for (int i = 0; i < order.Count; i++)
            {
                starts[i] = at;
                at += tracks[order[i]].SlotDuration + GapSeconds;
            }
            cycle = at;
            return starts;
        }

        /// <summary>Слот расписания в момент time и смещение внутри слота (≥ длительности — пауза между записями).</summary>
        public static int SlotAt(double time, double cycle, double[] starts, out double offset)
        {
            offset = 0d;
            if (starts == null || starts.Length == 0 || cycle <= 0d) return -1;
            double t = ((time % cycle) + cycle) % cycle;
            int slot = starts.Length - 1;
            for (int i = 1; i < starts.Length; i++)
            {
                if (starts[i] > t) { slot = i - 1; break; }
            }
            offset = t - starts[slot];
            return slot;
        }

        /// <summary>Разбор seed и эпохи расписания из манифеста; без полей — значения по умолчанию.</summary>
        public static void ReadScheduleSettings(string json, out int seed, out double epoch)
        {
            JObject root = JObject.Parse(json ?? "{}");
            seed = (int)Number(root["scheduleSeed"]);
            double parsedEpoch = Number(root["scheduleEpoch"]);
            epoch = parsedEpoch > 0d ? parsedEpoch : DefaultScheduleEpoch;
        }

        /// <summary>Поправка часов из заголовка Date (RFC 1123) ответа сервера; 0, если заголовка нет.</summary>
        public static double ClockOffsetFromDateHeader(string dateHeader, double localUnixNow)
        {
            DateTime serverTime;
            if (string.IsNullOrEmpty(dateHeader) || !DateTime.TryParseExact(dateHeader, "r", CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out serverTime))
                return 0d;
            return (serverTime - UnixEpoch).TotalSeconds - localUnixNow;
        }

        private void RebuildSchedule()
        {
            _order = BuildOrder(_tracks, Channel, ScheduleSeed);
            _starts = BuildStarts(_tracks, _order, out _cycle);
            _currentSlot = -1;
            NextUpTitle = string.Empty;
        }

        private void UpdateLibrary()
        {
            if (!LibraryReady)
            {
                if (!_manifestRequested && Time.unscaledTime >= _nextManifestAttemptAt && !string.IsNullOrEmpty(RadioBaseUrl()))
                {
                    _manifestRequested = true;
                    StartCoroutine(FetchManifest());
                }
                return;
            }
            if (_order.Count == 0 || _music == null) return;

            double offset;
            int slot = SlotAt(ScheduleNow(), _cycle, _starts, out offset);
            if (slot < 0) return;
            Track track = _tracks[_order[slot]];
            double slotDuration = track.SlotDuration;
            bool inGap = offset >= slotDuration;

            if (slot != _currentSlot)
            {
                // Новый слот: естественная смена, переключение канала или поздний вход.
                ReleaseCurrentClip();
                _hasCurrentTrack = false;
                NowPlayingTitle = string.Empty;
                _currentSlot = slot;
                NextUpTitle = _order.Count > 1 ? _tracks[_order[(slot + 1) % _order.Count]].Caption : string.Empty;
                if (_nextClip != null && _nextSlot == slot)
                {
                    StartClip(track, _nextClip, offset);
                    _nextClip = null;
                    _nextSlot = -1;
                }
                else if (_nextClip != null)
                {
                    Destroy(_nextClip);
                    _nextClip = null;
                    _nextSlot = -1;
                }
            }

            if (_hasCurrentTrack)
            {
                if (inGap)
                {
                    if (MusicPlaying) _music.Stop();
                }
                else if (MusicPlaying && Time.unscaledTime >= _nextDriftCheckAt)
                {
                    // Дрейф: часы клиента и декодер расходятся — подтягиваемся к расписанию.
                    _nextDriftCheckAt = Time.unscaledTime + DriftCheckSeconds;
                    if (Math.Abs(_music.time - offset) > DriftToleranceSeconds) Seek(offset);
                }
            }
            else if (!inGap && !_loadingTrack && Time.unscaledTime >= _nextLoadAttemptAt)
            {
                StartCoroutine(LoadTrack(slot, false));
            }

            // Следующая пластинка подгружается заранее, чтобы смена слота была бесшовной.
            double remaining = slotDuration + GapSeconds - offset;
            if (_order.Count > 1 && _nextClip == null && !_loadingTrack && remaining <= PreloadLeadSeconds
                && Time.unscaledTime >= _nextLoadAttemptAt)
                StartCoroutine(LoadTrack((slot + 1) % _order.Count, true));
        }

        private string RadioBaseUrl()
        {
            string url = BaseUrl;
            if (string.IsNullOrEmpty(url) && Pipboy != null) url = Pipboy.BaseUrl;
            return (url ?? string.Empty).TrimEnd('/');
        }

        private IEnumerator FetchManifest()
        {
            string url = RadioBaseUrl() + ManifestPath;
            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.SetRequestHeader("Cache-Control", "no-store");
                yield return request.SendWebRequest();
                _manifestRequested = false;
                List<Track> parsed = null;
                int seed = 0;
                double epoch = DefaultScheduleEpoch;
                if (request.result == UnityWebRequest.Result.Success)
                {
                    try
                    {
                        parsed = ParseManifest(request.downloadHandler.text);
                        ReadScheduleSettings(request.downloadHandler.text, out seed, out epoch);
                    }
                    catch (Exception error) { Debug.LogWarning("[ROA] Радио: манифест не разобран: " + error.Message); }
                }
                if (parsed == null || parsed.Count == 0)
                {
                    // 404 — библиотека ещё не собрана на сервере: молчим, проверим позже.
                    _manifestMissing = true;
                    _nextManifestAttemptAt = Time.unscaledTime + ManifestRetrySeconds;
                    ApplyChannelPresentation();
                    yield break;
                }
                ClockOffsetSeconds = ClockOffsetFromDateHeader(request.GetResponseHeader("Date"), UnixNow());
                ScheduleSeed = seed;
                ScheduleEpoch = epoch;
                _manifestMissing = false;
                _tracks.Clear();
                _tracks.AddRange(parsed);
                LibraryReady = true;
                RebuildSchedule();
                ApplyChannelPresentation();
                Debug.Log("[ROA] Радио: библиотека " + _tracks.Count + " треков, на канале "
                    + RoaPipboy.RadioTitles[Channel] + " — " + _order.Count + ", поправка часов "
                    + ClockOffsetSeconds.ToString("F1", CultureInfo.InvariantCulture) + " с");
            }
        }

        /// <summary>Манифест tools/radio-library.py: tracks[] с file/title/artist/year/source/license/channels.</summary>
        public static List<Track> ParseManifest(string json)
        {
            var result = new List<Track>();
            JObject root = JObject.Parse(json ?? "{}");
            JArray tracks = root["tracks"] as JArray ?? new JArray();
            foreach (JToken token in tracks)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string file = row["file"]?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(file)) continue;
                int mask = 0;
                foreach (JToken channel in row["channels"] as JArray ?? new JArray())
                {
                    switch ((channel?.ToString() ?? string.Empty).ToLowerInvariant())
                    {
                        case "beacon": mask |= 1 << ChannelBeacon; break;
                        case "ash": mask |= 1 << ChannelAsh; break;
                        case "safety": mask |= 1 << ChannelSafety; break;
                    }
                }
                if (mask == 0) mask = 1 << ChannelAsh;
                result.Add(new Track
                {
                    Id = row["id"]?.ToString() ?? file,
                    File = file,
                    Title = row["title"]?.ToString() ?? file,
                    Artist = row["artist"]?.ToString() ?? string.Empty,
                    Year = row["year"]?.ToString() ?? string.Empty,
                    Source = row["source"]?.ToString() ?? string.Empty,
                    License = row["license"]?.ToString() ?? string.Empty,
                    ChannelMask = mask,
                    Duration = (float)Number(row["duration"])
                });
            }
            return result;
        }

        private IEnumerator LoadTrack(int slot, bool preload)
        {
            _loadingTrack = true;
            int request = ++_trackRequest;
            Track track = _tracks[_order[slot]];
            string url = RadioBaseUrl() + "/radio/" + UnityWebRequest.EscapeURL(track.File).Replace("+", "%20");
            using (UnityWebRequest web = UnityWebRequestMultimedia.GetAudioClip(url, AudioType.MPEG))
            {
                // Клип грузится целиком: по расписанию нужно вставать в середину записи,
                // а перемотка потокового клипа ненадёжна.
                var handler = web.downloadHandler as DownloadHandlerAudioClip;
                if (handler != null) handler.streamAudio = false;
                yield return web.SendWebRequest();
                _loadingTrack = false;
                if (request != _trackRequest) yield break;
                AudioClip clip = web.result == UnityWebRequest.Result.Success && handler != null ? handler.audioClip : null;
                if (clip == null)
                {
                    _trackFailures++;
                    _nextLoadAttemptAt = Time.unscaledTime + Mathf.Min(30f, 2f * _trackFailures);
                    Debug.LogWarning("[ROA] Радио: трек не загрузился: " + track.File + " — " + web.error);
                    yield break;
                }
                _trackFailures = 0;
                if (preload)
                {
                    if (_nextClip != null) Destroy(_nextClip);
                    _nextClip = clip;
                    _nextSlot = slot;
                    yield break;
                }
                double offset;
                int nowSlot = SlotAt(ScheduleNow(), _cycle, _starts, out offset);
                if (nowSlot == slot && nowSlot == _currentSlot && offset < track.SlotDuration) StartClip(track, clip, offset);
                else Destroy(clip);
            }
        }

        private void StartClip(Track track, AudioClip clip, double offset)
        {
            if (_music == null || clip == null) return;
            ReleaseCurrentClip();
            _hasCurrentTrack = true;
            _music.clip = clip;
            _music.volume = 0f;
            Seek(offset);
            _music.Play();
            _nextDriftCheckAt = Time.unscaledTime + DriftCheckSeconds;
            NowPlayingTitle = track.Caption;
        }

        private void Seek(double offset)
        {
            if (_music == null || _music.clip == null) return;
            float length = _music.clip.length;
            _music.time = Mathf.Clamp((float)offset, 0f, Mathf.Max(0f, length - 0.05f));
        }

        private void ReleaseCurrentClip()
        {
            if (_music == null) return;
            AudioClip clip = _music.clip;
            _music.clip = null;
            if (clip != null) Destroy(clip);
        }

        private void StopMusic()
        {
            _trackRequest++;
            _loadingTrack = false;
            if (_music != null)
            {
                _music.Stop();
                ReleaseCurrentClip();
            }
            if (_nextClip != null) { Destroy(_nextClip); _nextClip = null; }
            _nextSlot = -1;
            _currentSlot = -1;
            _hasCurrentTrack = false;
            NowPlayingTitle = string.Empty;
            NextUpTitle = string.Empty;
        }

        // ------------------------------------------------------------------
        // Лента эфира из сводки пустоши
        // ------------------------------------------------------------------

        /// <summary>Разложить публичную сводку по каналу: угрозы, торговля/поселения, прочие пакеты.</summary>
        public void ApplyWasteland(JObject wasteland)
        {
            if (wasteland == null) return;
            _appliedWorldUpdatedAt = Number(wasteland["updatedAt"]);
            JArray events = wasteland["events"] as JArray ?? new JArray();
            JArray parties = wasteland["parties"] as JArray ?? new JArray();
            int worldHour = Mathf.FloorToInt((float)Number(wasteland["worldHour"]));

            DangerCount = CountHostileParties(parties);

            var fresh = new List<Broadcast>();
            foreach (JToken token in events)
            {
                JObject row = token as JObject;
                if (row == null) continue;
                string type = row["type"]?.ToString() ?? string.Empty;
                string title = row["title"]?.ToString() ?? row["text"]?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(title)) continue;
                if (ChannelForEvent(type, title) != Channel) continue;
                string key = (row["id"]?.ToString() ?? string.Empty) + "|" + type + "|" + title;
                if (!_seenEventKeys.Add(key)) continue;
                int hour = row["hour"] != null ? Mathf.FloorToInt((float)Number(row["hour"])) : worldHour;
                fresh.Add(new Broadcast { Stamp = StampFor(Channel, hour), Text = LineFor(Channel, title) });
                if (fresh.Count >= MaxBroadcastLines) break;
            }
            for (int i = fresh.Count - 1; i >= 0; i--) _lines.Insert(0, fresh[i]);
            while (_lines.Count > MaxBroadcastLines) _lines.RemoveAt(_lines.Count - 1);

            int caravansArrived = (int)Number(wasteland["stats"]?["caravansArrived"]);
            int caravansLost = (int)Number(wasteland["stats"]?["caravansLost"]);
            int sites = (wasteland["sites"] as JArray)?.Count ?? 0;
            switch (Channel)
            {
                case ChannelBeacon:
                    StatusLine = "Поселенческий маяк · час мира " + worldHour;
                    SignalLine = "Караванов дошло " + caravansArrived + ", потеряно " + caravansLost
                        + ". " + LibraryLine();
                    break;
                case ChannelAsh:
                    StatusLine = "Шум Стеколья · несущая " + worldHour + "h";
                    SignalLine = "В сети " + sites + " узлов. " + LibraryLine();
                    break;
                case ChannelSafety:
                    StatusLine = DangerCount > 0
                        ? "Канал безопасности · тревога"
                        : "Канал безопасности · чисто";
                    SignalLine = (DangerCount > 0
                        ? "Враждебных групп на карте: " + DangerCount + ". "
                        : "Враждебных групп на карте не отмечено. ") + LibraryLine();
                    break;
                default:
                    StatusLine = "Приёмник отключён";
                    SignalLine = "Остаётся только системный журнал.";
                    break;
            }
        }

        /// <summary>Канал события по типу и заголовку: угрозы → безопасность, торговля и поселения → маяк, остальное → пепел.</summary>
        public static int ChannelForEvent(string type, string title)
        {
            string haystack = ((type ?? string.Empty) + " " + (title ?? string.Empty)).ToLowerInvariant();
            if (ContainsAny(haystack, "raid", "attack", "ambush", "siege", "assault", "threat", "battle",
                    "destroyed", "lost", "hostile", "нападен", "рейд", "засад", "осад", "уничтож", "угроз", "бой"))
                return ChannelSafety;
            if (ContainsAny(haystack, "caravan", "trade", "arrived", "market", "supply", "contract", "settlement",
                    "harvest", "production", "караван", "торг", "прибыл", "рынок", "постав", "контракт", "поселен",
                    "урожа", "производ"))
                return ChannelBeacon;
            return ChannelAsh;
        }

        public static string LineFor(int channel, string title)
        {
            string text = (title ?? string.Empty).Trim();
            switch (ClampChannel(channel))
            {
                case ChannelBeacon: return "Маяк: " + text;
                case ChannelAsh: return "Пакет данных: …" + text + "…";
                case ChannelSafety: return "Тревога: " + text;
                default: return text;
            }
        }

        public static string StampFor(int channel, int hour)
        {
            switch (ClampChannel(channel))
            {
                case ChannelAsh: return "несущая " + hour + "h";
                case ChannelSafety: return "сигнал " + hour + "h";
                default: return "час мира " + hour;
            }
        }

        public static int CountHostileParties(JArray parties)
        {
            int count = 0;
            foreach (JToken token in parties ?? new JArray())
            {
                JObject party = token as JObject;
                if (party == null) continue;
                if (party["destroyed"]?.ToObject<bool>() == true) continue;
                if (string.Equals(party["state"]?.ToString(), "destroyed", StringComparison.OrdinalIgnoreCase)) continue;
                string faction = (party["faction"]?.ToString() ?? string.Empty).ToLowerInvariant();
                string kind = (party["kind"]?.ToString() ?? string.Empty).ToLowerInvariant();
                bool hostile = kind == "monster" || kind == "raiders" || kind == "raid";
                for (int i = 0; i < HostileFactions.Length && !hostile; i++)
                    hostile = faction == HostileFactions[i];
                if (hostile) count++;
            }
            return count;
        }

        // ------------------------------------------------------------------
        // Строки состояния
        // ------------------------------------------------------------------

        /// <summary>Что слышно на канале: пластинки библиотеки, тишина без манифеста или пустая частота.</summary>
        public string LibraryLine()
        {
            if (!LibraryReady)
                return _manifestMissing
                    ? "Библиотека эфира недоступна, повтор запроса через минуту."
                    : "Настройка на несущую…";
            if (_order.Count == 0) return "На этой частоте записей нет.";
            return "В ротации " + _order.Count + " " + Plural(_order.Count, "запись", "записи", "записей")
                + ", эфир общий для всех приёмников.";
        }

        private void ApplyChannelPresentation()
        {
            if (Channel == ChannelSilence)
            {
                StatusLine = "Приёмник отключён";
                SignalLine = "Остаётся только системный журнал.";
                return;
            }
            StatusLine = RoaPipboy.RadioTitles[Channel];
            SignalLine = LibraryLine();
        }

        public static string Plural(int count, string one, string few, string many)
        {
            int mod10 = count % 10, mod100 = count % 100;
            if (mod10 == 1 && mod100 != 11) return one;
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
            return many;
        }

        private static bool ContainsAny(string haystack, params string[] needles)
        {
            for (int i = 0; i < needles.Length; i++)
                if (haystack.Contains(needles[i])) return true;
            return false;
        }

        private static int ClampChannel(int channel)
        {
            return Mathf.Clamp(channel, ChannelBeacon, ChannelSilence);
        }

        private static double Number(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return 0d;
            // Числовые JToken читаются напрямую: JValue.ToString() форматирует double
            // текущей культурой, и "173,3" при инвариантном разборе молча даёт 0.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<double>();
            double value;
            return double.TryParse(token.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value) ? value : 0d;
        }
    }
}
