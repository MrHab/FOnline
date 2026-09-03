using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Рабочее радио Pip-Boy. Четыре канала браузерной версии остаются теми же,
    /// но выбранный канал теперь реально звучит: эфир синтезируется при старте,
    /// как и весь звук клиента (без стриминга и лицензий), а текстовая лента
    /// «эфира» строится из публичной сводки пустоши (/api/wasteland). Выбор
    /// канала переживает перезапуск клиента. Радио — чистая презентация:
    /// сервер о нём не знает, игровых эффектов нет.
    /// </summary>
    public sealed class RoaRadio : MonoBehaviour
    {
        public const int ChannelBeacon = 0;
        public const int ChannelAsh = 1;
        public const int ChannelSafety = 2;
        public const int ChannelSilence = 3;
        /// <summary>3 подложки + 8 нот маяка + пакет, свип, тревога, тик, джингл.</summary>
        public const int ExpectedClipCount = 16;

        private const int SampleRate = 44100;
        private const string ChannelPrefsKey = "roa.radio.channel.v1";
        private const float WorldRefreshSeconds = 20f;
        private const float BedFadeSpeed = 0.35f;
        private const int MaxBroadcastLines = 6;

        private static readonly float[] BeaconScale =
            { 220f, 261.63f, 293.66f, 329.63f, 392f, 440f, 523.25f, 587.33f };

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

        public RoaPipboy Pipboy;
        public RoaGameBootstrap Bootstrap;

        public int Channel { get; private set; }
        public int GeneratedClipCount { get { return _clips.Count; } }
        public int DangerCount { get; private set; }
        public string BedClipName { get { return _bedClip != null ? _bedClip.name : string.Empty; } }
        public bool Playing { get { return _bed != null && _bed.isPlaying && _bed.volume > 0.001f; } }
        public IReadOnlyList<Broadcast> Lines { get { return _lines; } }
        public string StatusLine { get; private set; } = "Приёмник отключён";
        public string SignalLine { get; private set; } = string.Empty;

        private readonly List<AudioClip> _clips = new List<AudioClip>();
        private readonly List<Broadcast> _lines = new List<Broadcast>();
        private readonly HashSet<string> _seenEventKeys = new HashSet<string>();
        private AudioSource _bed;
        private AudioSource _voice;
        private AudioClip _bedClip;
        private AudioClip _static;
        private AudioClip _carrier;
        private AudioClip _pad;
        private AudioClip[] _notes;
        private AudioClip _packet;
        private AudioClip _sweep;
        private AudioClip _alert;
        private AudioClip _tick;
        private AudioClip _jingle;
        private float _bedTarget;
        private float _nextBeatAt;
        private float _nextAccentAt;
        private float _nextWorldRefreshAt;
        private double _appliedWorldUpdatedAt = -1d;
        private int _lastNote = 3;
        private uint _rng = 0x2f6b1a3du;
        private bool _clipsBuilt;

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
            for (int i = 0; i < _clips.Count; i++)
            {
                if (_clips[i] == null) continue;
                if (Application.isPlaying) Destroy(_clips[i]);
                else DestroyImmediate(_clips[i]);
            }
            _clips.Clear();
        }

        /// <summary>Генерация клипов и источников — идемпотентна, пробы вызывают её без Awake.</summary>
        public void EnsureBuilt()
        {
            if (_clipsBuilt) return;
            _clipsBuilt = true;
            _bed = Source("RadioBed");
            _bed.loop = true;
            _voice = Source("RadioVoice");
            BuildClips();
        }

        public void SetChannel(int channel)
        {
            int next = ClampChannel(channel);
            if (next == Channel && _bedClip != null) return;
            Channel = next;
            PlayerPrefs.SetInt(ChannelPrefsKey, Channel);
            PlayerPrefs.Save();
            if (Pipboy != null && Pipboy.RadioChannel != Channel) Pipboy.RadioChannel = Channel;
            _lines.Clear();
            _seenEventKeys.Clear();
            _appliedWorldUpdatedAt = -1d;
            _nextBeatAt = Time.unscaledTime + 0.6f;
            _nextAccentAt = Time.unscaledTime + 4f;
            ApplyChannelPresentation();
            if (Pipboy != null && Pipboy.Wasteland != null) ApplyWasteland(Pipboy.Wasteland);
        }

        private void Update()
        {
            if (Pipboy != null && Pipboy.RadioChannel != Channel) SetChannel(Pipboy.RadioChannel);

            bool inGame = Bootstrap == null || Bootstrap.InGame;
            bool live = inGame && Channel != ChannelSilence;
            float dt = Mathf.Max(0.001f, Time.unscaledDeltaTime);
            float target = live ? _bedTarget : 0f;
            if (_bed != null)
            {
                _bed.volume = Mathf.MoveTowards(_bed.volume, target, dt * BedFadeSpeed);
                if (live && !_bed.isPlaying && _bedClip != null) _bed.Play();
                if (!live && _bed.isPlaying && _bed.volume <= 0.001f) _bed.Stop();
            }
            if (!live) return;

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

            UpdateSchedule();
        }

        // ------------------------------------------------------------------
        // Расписание эфира
        // ------------------------------------------------------------------

        private void UpdateSchedule()
        {
            float now = Time.unscaledTime;
            if (now >= _nextBeatAt)
            {
                switch (Channel)
                {
                    case ChannelBeacon:
                        // Мелодия маяка: случайное блуждание по пентатонике с паузами.
                        if (NextUnit() > 0.24f)
                        {
                            _lastNote = NextBeaconNote(_lastNote, NextUnit());
                            PlayVoice(_notes[_lastNote], 0.16f, 1f);
                        }
                        break;
                    case ChannelAsh:
                        PlayVoice(_packet, 0.12f, Mathf.Lerp(0.92f, 1.1f, NextUnit()));
                        break;
                    case ChannelSafety:
                        if (DangerCount > 0) PlayVoice(_alert, 0.18f, 1f);
                        else PlayVoice(_tick, 0.14f, 1f);
                        break;
                }
                _nextBeatAt = now + BeatInterval(Channel, DangerCount) * Mathf.Lerp(0.85f, 1.15f, NextUnit());
            }
            if (now >= _nextAccentAt)
            {
                switch (Channel)
                {
                    case ChannelBeacon: PlayVoice(_jingle, 0.15f, 1f); break;
                    case ChannelAsh: PlayVoice(_sweep, 0.1f, Mathf.Lerp(0.9f, 1.08f, NextUnit())); break;
                    case ChannelSafety: if (DangerCount > 0) PlayVoice(_alert, 0.12f, 0.82f); break;
                }
                _nextAccentAt = now + AccentInterval(Channel) * Mathf.Lerp(0.8f, 1.25f, NextUnit());
            }
        }

        /// <summary>Пауза между ударами эфира: тревога учащается с числом угроз.</summary>
        public static float BeatInterval(int channel, int dangerCount)
        {
            switch (ClampChannel(channel))
            {
                case ChannelBeacon: return 0.5f;
                case ChannelAsh: return 4.5f;
                case ChannelSafety:
                    return dangerCount > 0 ? Mathf.Max(2.4f, 7.5f - dangerCount * 1.3f) : 6f;
                default: return 3600f;
            }
        }

        public static float AccentInterval(int channel)
        {
            switch (ClampChannel(channel))
            {
                case ChannelBeacon: return 16f;
                case ChannelAsh: return 11f;
                case ChannelSafety: return 9f;
                default: return 3600f;
            }
        }

        /// <summary>Следующая нота маяка: шаг ±1–2 по гамме, редкий скачок к тонике.</summary>
        public static int NextBeaconNote(int previous, float roll)
        {
            int count = BeaconScale.Length;
            int current = Mathf.Clamp(previous, 0, count - 1);
            if (roll < 0.08f) return 0;
            if (roll < 0.14f) return count - 3;
            int step = roll < 0.5f ? -1 : 1;
            if (roll > 0.42f && roll < 0.58f) step *= 2;
            return Mathf.Clamp(current + step, 0, count - 1);
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
                        + ". Сигнал слабый, но устойчивый.";
                    break;
                case ChannelAsh:
                    StatusLine = "Пепельная частота · несущая " + worldHour + "h";
                    SignalLine = "В сети " + sites + " узлов; пакеты из старых ретрансляторов приходят с шумом.";
                    break;
                case ChannelSafety:
                    StatusLine = DangerCount > 0
                        ? "Канал безопасности · тревога"
                        : "Канал безопасности · чисто";
                    SignalLine = DangerCount > 0
                        ? "Враждебных групп на карте: " + DangerCount + ". Автоматический сигнал повторяется."
                        : "Враждебных групп на карте не отмечено. Дежурный тик каждые несколько секунд.";
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
        // Звук
        // ------------------------------------------------------------------

        private void ApplyChannelPresentation()
        {
            AudioClip next;
            float volume;
            switch (Channel)
            {
                case ChannelBeacon: next = _pad; volume = 0.1f; break;
                case ChannelAsh: next = _static; volume = 0.09f; break;
                case ChannelSafety: next = _carrier; volume = 0.075f; break;
                default: next = null; volume = 0f; break;
            }
            _bedClip = next;
            _bedTarget = volume;
            if (Channel == ChannelSilence)
            {
                StatusLine = "Приёмник отключён";
                SignalLine = "Остаётся только системный журнал.";
            }
            else if (string.IsNullOrEmpty(SignalLine) || StatusLine == "Приёмник отключён")
            {
                StatusLine = RoaPipboy.RadioTitles[Channel];
                SignalLine = "Настройка на несущую…";
            }
            if (_bed == null) return;
            if (next == null)
            {
                _bed.Stop();
                _bed.clip = null;
                return;
            }
            if (_bed.clip != next)
            {
                _bed.Stop();
                _bed.clip = next;
                _bed.volume = 0f;
                if (Application.isPlaying) _bed.Play();
            }
        }

        private void PlayVoice(AudioClip clip, float volume, float pitch)
        {
            if (clip == null || _voice == null) return;
            _voice.pitch = pitch;
            _voice.PlayOneShot(clip, volume);
        }

        private AudioSource Source(string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var source = go.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.spatialBlend = 0f;
            source.dopplerLevel = 0f;
            source.ignoreListenerPause = true;
            return source;
        }

        private void BuildClips()
        {
            _static = BuildStaticBed();
            _carrier = BuildCarrierBed();
            _pad = BuildPadBed();
            _notes = new AudioClip[BeaconScale.Length];
            for (int i = 0; i < BeaconScale.Length; i++)
                _notes[i] = BuildNote("RadioBeaconNote" + i, BeaconScale[i]);
            _packet = BuildPacket();
            _sweep = BuildSweep();
            _alert = BuildAlert();
            _tick = BuildTick();
            _jingle = BuildJingle();
        }

        private AudioClip BuildStaticBed()
        {
            uint state = 0x51ac3e2bu;
            float left = 0f;
            float right = 0f;
            return Stereo("RadioStaticBed", 6f, (time, progress, seconds) =>
            {
                left = Mathf.Lerp(left, Noise(ref state), 0.35f);
                right = Mathf.Lerp(right, Noise(ref state), 0.31f);
                float wobble = 0.62f + 0.24f * Mathf.Sin(Mathf.PI * 2f * time / seconds * 2f)
                    + 0.14f * Mathf.Sin(Mathf.PI * 2f * time / seconds * 5f + 0.9f);
                float crackle = Noise(ref state) > 0.9985f ? Noise(ref state) * 0.7f : 0f;
                return new Vector2(
                    Mathf.Clamp(left * wobble * 0.55f + crackle, -0.6f, 0.6f),
                    Mathf.Clamp(right * wobble * 0.55f + crackle * 0.6f, -0.6f, 0.6f));
            });
        }

        private AudioClip BuildCarrierBed()
        {
            uint state = 0x1b7e9c41u;
            return Stereo("RadioCarrierBed", 6f, (time, progress, seconds) =>
            {
                float hum = Mathf.Sin(Mathf.PI * 2f * 50f * time) * 0.22f
                    + Mathf.Sin(Mathf.PI * 2f * 100f * time + 0.4f) * 0.08f;
                float whistle = Mathf.Sin(Mathf.PI * 2f * 1000f * time)
                    * (0.05f + 0.03f * Mathf.Sin(Mathf.PI * 2f * time / seconds * 3f));
                float hiss = Noise(ref state) * 0.035f;
                return new Vector2(
                    Mathf.Clamp(hum + whistle + hiss, -0.5f, 0.5f),
                    Mathf.Clamp(hum * 0.9f + whistle * 0.8f + hiss, -0.5f, 0.5f));
            });
        }

        private AudioClip BuildPadBed()
        {
            uint state = 0x7d21c05fu;
            return Stereo("RadioBeaconPad", 8f, (time, progress, seconds) =>
            {
                float vibrato = 1f + 0.0035f * Mathf.Sin(Mathf.PI * 2f * time / seconds * 4f);
                float chord = Mathf.Sin(Mathf.PI * 2f * 110f * time * vibrato) * 0.3f
                    + Mathf.Sin(Mathf.PI * 2f * 164.81f * time) * 0.2f
                    + Mathf.Sin(Mathf.PI * 2f * 220f * time * vibrato + 0.6f) * 0.16f;
                float breath = 0.7f + 0.3f * Mathf.Sin(Mathf.PI * 2f * time / seconds * 2f);
                float hiss = Noise(ref state) * 0.02f;
                return new Vector2(
                    Mathf.Clamp(chord * breath + hiss, -0.6f, 0.6f),
                    Mathf.Clamp(chord * breath * 0.92f - hiss, -0.6f, 0.6f));
            });
        }

        private AudioClip BuildNote(string name, float hz)
        {
            float phase = 0f;
            return Mono(name, 0.7f, (time, progress) =>
            {
                phase += Mathf.PI * 2f * hz / SampleRate;
                float attack = Mathf.Sin(Mathf.Clamp01(progress / 0.04f) * Mathf.PI * 0.5f);
                float decay = Mathf.Exp(-progress * 3.4f);
                float tone = Mathf.Sin(phase) * 0.6f + Mathf.Sin(phase * 2f) * 0.14f + Mathf.Sin(phase * 3f) * 0.05f;
                return Mathf.Clamp(tone * attack * decay, -0.8f, 0.8f);
            });
        }

        private AudioClip BuildPacket()
        {
            uint state = 0x39d1a7e3u;
            float phase = 0f;
            int segments = 16;
            var bits = new bool[segments];
            for (int i = 0; i < segments; i++) bits[i] = Noise(ref state) > 0f;
            return Mono("RadioPacket", 0.42f, (time, progress) =>
            {
                int segment = Mathf.Min(segments - 1, Mathf.FloorToInt(progress * segments));
                float local = progress * segments - segment;
                float hz = bits[segment] ? 2200f : 1200f;
                phase += Mathf.PI * 2f * hz / SampleRate;
                float envelope = Mathf.Sin(Mathf.Clamp01(local / 0.15f) * Mathf.PI * 0.5f)
                    * Mathf.Sin(Mathf.Clamp01((1f - local) / 0.15f) * Mathf.PI * 0.5f);
                float global = Mathf.Sin(Mathf.Clamp01(progress / 0.05f) * Mathf.PI * 0.5f)
                    * Mathf.Pow(1f - progress, 0.3f);
                return Mathf.Clamp((Mathf.Sin(phase) * 0.6f + Noise(ref state) * 0.04f) * envelope * global, -0.8f, 0.8f);
            });
        }

        private AudioClip BuildSweep()
        {
            uint state = 0x6c2e91b5u;
            float phase = 0f;
            return Mono("RadioSweep", 0.9f, (time, progress) =>
            {
                float hz = progress < 0.6f
                    ? Mathf.Lerp(300f, 2400f, progress / 0.6f)
                    : Mathf.Lerp(2400f, 900f, (progress - 0.6f) / 0.4f);
                phase += Mathf.PI * 2f * hz / SampleRate;
                float envelope = Mathf.Sin(progress * Mathf.PI);
                return Mathf.Clamp((Mathf.Sin(phase) * 0.42f + Noise(ref state) * 0.12f) * envelope, -0.7f, 0.7f);
            });
        }

        private AudioClip BuildAlert()
        {
            float phase = 0f;
            return Mono("RadioAlert", 0.36f, (time, progress) =>
            {
                bool second = progress >= 0.5f;
                float local = second ? (progress - 0.5f) * 2f : progress * 2f;
                phase += Mathf.PI * 2f * (second ? 660f : 880f) / SampleRate;
                float envelope = Mathf.Sin(Mathf.Clamp01(local / 0.1f) * Mathf.PI * 0.5f) * Mathf.Pow(1f - local, 1.4f);
                return Mathf.Clamp((Mathf.Sin(phase) * 0.6f + Mathf.Sin(phase * 2f) * 0.1f) * envelope, -0.8f, 0.8f);
            });
        }

        private AudioClip BuildTick()
        {
            uint state = 0x4a91f3c7u;
            return Mono("RadioTick", 0.05f, (time, progress) =>
            {
                float envelope = Mathf.Exp(-progress * 9f);
                return Mathf.Clamp((Mathf.Sin(Mathf.PI * 2f * 1400f * time) * 0.5f + Noise(ref state) * 0.2f) * envelope, -0.7f, 0.7f);
            });
        }

        private AudioClip BuildJingle()
        {
            float[] notes = { 392f, 523.25f, 659.25f };
            float phase = 0f;
            return Mono("RadioJingle", 0.66f, (time, progress) =>
            {
                float position = progress * notes.Length;
                int index = Mathf.Min(notes.Length - 1, Mathf.FloorToInt(position));
                float local = position - index;
                phase += Mathf.PI * 2f * notes[index] / SampleRate;
                float attack = Mathf.Sin(Mathf.Clamp01(local / 0.1f) * Mathf.PI * 0.5f);
                float release = Mathf.Pow(Mathf.Clamp01(1f - local), 1.1f);
                float global = Mathf.Pow(1f - progress, 0.2f);
                return Mathf.Clamp((Mathf.Sin(phase) * 0.58f + Mathf.Sin(phase * 2f) * 0.12f) * attack * release * global, -0.8f, 0.8f);
            });
        }

        private delegate float MonoSynth(float time, float progress);
        private delegate Vector2 StereoSynth(float time, float progress, float seconds);

        private AudioClip Mono(string name, float seconds, MonoSynth synth)
        {
            int count = Mathf.Max(1, Mathf.RoundToInt(seconds * SampleRate));
            var data = new float[count];
            for (int i = 0; i < count; i++)
                data[i] = synth(i / (float)SampleRate, i / (float)Mathf.Max(1, count - 1));
            return Store(AudioClip.Create(name, count, 1, SampleRate, false), data);
        }

        /// <summary>Стерео-подложка с перекрёстным затуханием хвоста в начало — петля без щелчка.</summary>
        private AudioClip Stereo(string name, float seconds, StereoSynth synth)
        {
            int frames = Mathf.RoundToInt(seconds * SampleRate);
            var data = new float[frames * 2];
            for (int i = 0; i < frames; i++)
            {
                Vector2 sample = synth(i / (float)SampleRate, i / (float)Mathf.Max(1, frames - 1), seconds);
                data[i * 2] = sample.x;
                data[i * 2 + 1] = sample.y;
            }
            int crossFrames = SampleRate / 2;
            for (int i = 0; i < crossFrames; i++)
            {
                float mix = i / (float)crossFrames;
                int tail = frames - crossFrames + i;
                data[tail * 2] = Mathf.Lerp(data[tail * 2], data[i * 2], mix);
                data[tail * 2 + 1] = Mathf.Lerp(data[tail * 2 + 1], data[i * 2 + 1], mix);
            }
            return Store(AudioClip.Create(name, frames, 2, SampleRate, false), data);
        }

        private AudioClip Store(AudioClip clip, float[] data)
        {
            float peak = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                if (float.IsNaN(data[i]) || float.IsInfinity(data[i]))
                    throw new InvalidOperationException("Radio audio contains a non-finite sample: " + clip.name);
                peak = Mathf.Max(peak, Mathf.Abs(data[i]));
            }
            if (peak < 0.005f) throw new InvalidOperationException("Radio audio is silent: " + clip.name);
            clip.SetData(data, 0);
            _clips.Add(clip);
            return clip;
        }

        private float NextUnit()
        {
            _rng = _rng * 1664525u + 1013904223u;
            return ((_rng >> 8) & 0xffffu) / 65535f;
        }

        private static float Noise(ref uint state)
        {
            state = state * 1664525u + 1013904223u;
            return (((state >> 8) & 0xffffu) / 32767.5f) - 1f;
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
            double value;
            return double.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out value) ? value : 0d;
        }
    }
}
