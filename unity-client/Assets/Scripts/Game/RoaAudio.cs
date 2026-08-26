using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Runtime soundscape for the Unity client. All clips are generated once at
    /// startup, so desktop and WebGL receive a complete, license-free audio layer
    /// without streamed assets. Gameplay remains server-authoritative: this class
    /// only reacts to already accepted actions and visual relays.
    /// </summary>
    public sealed class RoaAudio : MonoBehaviour
    {
        private const int SampleRate = 44100;
        private const int WorldVoiceCount = 14;
        private const string VolumePrefsKey = "roa.audio.master.v1";

        public static RoaAudio Active { get; private set; }

        public int VolumePercent { get { return Mathf.RoundToInt(_masterVolume * 100f); } }
        public bool Muted { get { return _masterVolume <= 0.001f; } }
        public int GeneratedClipCount { get { return _validatedClipCount; } }
        public bool ActivityCuesReady
        {
            get
            {
                return _activityStart != null && _activityProgress != null && _activityExtraction != null
                    && _activitySuccess != null && _activityFailure != null;
            }
        }

        public struct FootstepCue
        {
            public Vector3 Position;
            public Vector3 Velocity;
            public float Speed;
            public bool Crouching;
            public bool RightFoot;
        }

        /// <summary>Visual-only cadence signal emitted with the same accepted step as the sound.</summary>
        public event Action<FootstepCue> Footstep;

        private readonly List<AudioClip> _clips = new List<AudioClip>();
        private readonly List<AudioSource> _worldVoices = new List<AudioSource>();
        private RoaGameBootstrap _bootstrap;
        private AudioSource _ambience;
        private AudioSource _ui;
        private AudioSource _feet;
        private AudioClip _wind;
        private AudioClip _pistol;
        private AudioClip _rifle;
        private AudioClip _shotgun;
        private AudioClip _machineGun;
        private AudioClip _laser;
        private AudioClip _plasma;
        private AudioClip _rocket;
        private AudioClip _flame;
        private AudioClip _impact;
        private AudioClip _explosion;
        private AudioClip _meleeSwing;
        private AudioClip _meleeImpact;
        private AudioClip _hurt;
        private AudioClip _killConfirm;
        private AudioClip _reload;
        private AudioClip _uiClick;
        private AudioClip _panelOpen;
        private AudioClip _panelClose;
        private AudioClip _activityStart;
        private AudioClip _activityProgress;
        private AudioClip _activityExtraction;
        private AudioClip _activitySuccess;
        private AudioClip _activityFailure;
        private AudioClip[] _steps;

        private Vector3 _playerPosition;
        private Vector3 _locomotion;
        private bool _grounded;
        private bool _crouching;
        private bool _panelWasOpen;
        private float _nextStepAt;
        private float _lastUiAt;
        private float _lastActivityAt = -100f;
        private RoaActivityFeedbackCue _lastActivityCue;
        private float _masterVolume;
        private int _worldCursor;
        private int _validatedClipCount;
        private bool _rightFoot;
        private uint _variationState = 0x7f4a7c15u;

        public void Configure(RoaGameBootstrap bootstrap)
        {
            _bootstrap = bootstrap;
        }

        private void Awake()
        {
            if (Active != null && Active != this)
            {
                Destroy(this);
                return;
            }
            Active = this;
            _masterVolume = Mathf.Clamp01(PlayerPrefs.GetFloat(VolumePrefsKey, 0.8f));
            AudioListener.volume = _masterVolume;
            BuildSources();
            BuildClips();
            Debug.Log("[ROA] Audio ready: " + _validatedClipCount + " validated generated clips, "
                + _worldVoices.Count + " pooled world voices, volume " + VolumePercent + "%");
            _ambience.clip = _wind;
            _ambience.loop = true;
            _ambience.volume = 0f;
            _ambience.Play();
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

        private void Update()
        {
            float dt = Mathf.Max(0.001f, Time.unscaledDeltaTime);
            AudioListener.volume = Mathf.MoveTowards(AudioListener.volume, _masterVolume, dt * 2.5f);

            bool inGame = _bootstrap != null && _bootstrap.InGame;
            bool panelOpen = inGame && RoaGameBootstrap.BlocksWorldHud;
            float ambientTarget = inGame ? (_bootstrap.OnGlobalMap ? 0.075f : 0.105f) : 0f;
            if (panelOpen) ambientTarget *= 0.5f;
            _ambience.volume = Mathf.MoveTowards(_ambience.volume, ambientTarget, dt * 0.08f);

            if (inGame && panelOpen != _panelWasOpen && Time.unscaledTime - _lastUiAt > 0.08f)
                PlayUi(panelOpen ? _panelOpen : _panelClose, 0.38f);
            _panelWasOpen = panelOpen;

            PollUiClick();
            UpdateFootsteps(inGame && !panelOpen);
        }

        public void SetLocomotion(Vector3 velocity, Vector3 worldPosition, bool grounded, bool crouching)
        {
            _locomotion = velocity;
            _locomotion.y = 0f;
            _playerPosition = worldPosition;
            _grounded = grounded;
            _crouching = crouching;
        }

        public void StopLocomotion()
        {
            _locomotion = Vector3.zero;
            _grounded = false;
            _nextStepAt = 0f;
            _rightFoot = false;
        }

        public void PlayActorFootstep(FootstepCue cue)
        {
            if (_steps == null || _steps.Length < 2 || cue.Speed < 0.28f) return;
            int index = NextVariation() < 0.5f ? 0 : 1;
            float pace = Mathf.InverseLerp(1.2f, 6.5f, cue.Speed);
            float volume = cue.Crouching ? 0.055f : Mathf.Lerp(0.09f, 0.17f, pace);
            PlayWorld(_steps[index], cue.Position, volume,
                Pitch(0.92f, 1.07f) * (cue.Crouching ? 0.9f : 1f), 14f, false);
        }

        public void PlayShot(Vector3 start, Vector3 end, string weaponId)
        {
            AudioClip clip = ShotClip(weaponId);
            float volume = weaponId == "rocketLauncher" ? 1f
                : weaponId == "shotgun" ? 0.9f
                : weaponId == "machineGun" ? 0.72f
                : 0.78f;
            PlayWorld(clip, start, volume, Pitch(0.97f, 1.035f), 42f);

            if (weaponId == "flamethrower") return;
            float distance = Vector3.Distance(start, end);
            float delay = Mathf.Clamp(distance / 343f, 0.015f, 0.09f);
            StartCoroutine(DelayedWorld(_impact, end, delay, 0.31f, Pitch(0.9f, 1.12f), 24f));
        }

        public void PlayExplosion(Vector3 center, float radius)
        {
            PlayWorld(_explosion, center, Mathf.Clamp01(0.72f + radius * 0.045f), Pitch(0.92f, 1.02f), 58f);
        }

        public void PlayMeleeSwing(Vector3 center)
        {
            PlayWorld(_meleeSwing, center, 0.5f, Pitch(0.92f, 1.08f), 16f);
        }

        public void PlayMeleeImpact(Vector3 center, bool critical)
        {
            PlayWorld(_meleeImpact, center, critical ? 0.82f : 0.62f,
                critical ? Pitch(0.78f, 0.9f) : Pitch(0.92f, 1.08f), 20f);
        }

        public void PlayHurt(int damage)
        {
            float strength = Mathf.InverseLerp(2f, 45f, Mathf.Max(0, damage));
            PlayUi(_hurt, Mathf.Lerp(0.38f, 0.72f, strength), Mathf.Lerp(1.08f, 0.86f, strength));
        }

        public void PlayKillConfirm()
        {
            PlayUi(_killConfirm, 0.34f, 1f);
        }

        public void PlayActivityCue(RoaActivityFeedbackCue cue)
        {
            if (cue == RoaActivityFeedbackCue.None) return;
            if (cue == RoaActivityFeedbackCue.Progress && _lastActivityCue == cue
                && Time.unscaledTime - _lastActivityAt < 0.42f) return;

            AudioClip clip;
            float volume;
            switch (cue)
            {
                case RoaActivityFeedbackCue.Started:
                    clip = _activityStart;
                    volume = 0.42f;
                    break;
                case RoaActivityFeedbackCue.Progress:
                    clip = _activityProgress;
                    volume = 0.24f;
                    break;
                case RoaActivityFeedbackCue.ExtractionOpened:
                    clip = _activityExtraction;
                    volume = 0.48f;
                    break;
                case RoaActivityFeedbackCue.Success:
                    clip = _activitySuccess;
                    volume = 0.52f;
                    break;
                case RoaActivityFeedbackCue.Failure:
                    clip = _activityFailure;
                    volume = 0.44f;
                    break;
                default:
                    return;
            }
            _lastActivityCue = cue;
            _lastActivityAt = Time.unscaledTime;
            PlayUi(clip, volume, Pitch(0.99f, 1.01f));
        }

        public void PlayReload()
        {
            PlayUi(_reload, 0.42f, Pitch(0.97f, 1.03f));
        }

        public void CycleMasterVolume()
        {
            float next = _masterVolume > 0.7f ? 0.5f
                : _masterVolume > 0.35f ? 0.25f
                : _masterVolume > 0.05f ? 0f
                : 0.8f;
            SetMasterVolume(next);
            if (next > 0f) PlayUi(_uiClick, 0.52f, 1.04f);
        }

        public void SetMasterVolume(float value)
        {
            _masterVolume = Mathf.Clamp01(value);
            PlayerPrefs.SetFloat(VolumePrefsKey, _masterVolume);
            PlayerPrefs.Save();
            if (_masterVolume <= 0f) AudioListener.volume = 0f;
        }

        private void PollUiClick()
        {
            EventSystem events = EventSystem.current;
            if (events == null) return;

            bool clicked = Input.GetMouseButtonDown(0) && events.IsPointerOverGameObject();
            for (int i = 0; i < Input.touchCount && !clicked; i++)
            {
                Touch touch = Input.GetTouch(i);
                clicked = touch.phase == TouchPhase.Began && events.IsPointerOverGameObject(touch.fingerId);
            }
            if (!clicked || Time.unscaledTime - _lastUiAt < 0.035f) return;
            PlayUi(_uiClick, 0.28f, Pitch(0.98f, 1.05f));
        }

        private void UpdateFootsteps(bool active)
        {
            float speed = _locomotion.magnitude;
            if (!active || !_grounded || speed < 0.28f)
            {
                if (speed < 0.1f) _nextStepAt = Mathf.Min(_nextStepAt, Time.unscaledTime + 0.08f);
                return;
            }
            if (Time.unscaledTime < _nextStepAt) return;

            int index = NextVariation() < 0.5f ? 0 : 1;
            _feet.transform.position = _playerPosition;
            _feet.pitch = Pitch(0.9f, 1.08f) * (_crouching ? 0.88f : 1f);
            _feet.volume = _crouching ? 0.18f : Mathf.Lerp(0.24f, 0.4f, Mathf.InverseLerp(1.5f, 6.5f, speed));
            _feet.PlayOneShot(_steps[index]);

            _rightFoot = !_rightFoot;
            Footstep?.Invoke(new FootstepCue
            {
                Position = _playerPosition,
                Velocity = _locomotion,
                Speed = speed,
                Crouching = _crouching,
                RightFoot = _rightFoot
            });

            float cadence = Mathf.Lerp(0.62f, 0.29f, Mathf.InverseLerp(0.4f, 7f, speed));
            _nextStepAt = Time.unscaledTime + cadence * (_crouching ? 1.22f : 1f);
        }

        private IEnumerator DelayedWorld(AudioClip clip, Vector3 position, float delay,
                                         float volume, float pitch, float maxDistance)
        {
            yield return new WaitForSecondsRealtime(delay);
            PlayWorld(clip, position, volume, pitch, maxDistance);
        }

        private void PlayUi(AudioClip clip, float volume, float pitch = 1f)
        {
            if (clip == null || _masterVolume <= 0f) return;
            _lastUiAt = Time.unscaledTime;
            _ui.pitch = pitch;
            _ui.PlayOneShot(clip, volume);
        }

        private void PlayWorld(AudioClip clip, Vector3 position, float volume, float pitch,
                               float maxDistance, bool allowSteal = true)
        {
            if (clip == null || _masterVolume <= 0f) return;
            AudioSource source = null;
            for (int i = 0; i < _worldVoices.Count; i++)
            {
                int index = (_worldCursor + i) % _worldVoices.Count;
                if (_worldVoices[index].isPlaying) continue;
                source = _worldVoices[index];
                _worldCursor = (index + 1) % _worldVoices.Count;
                break;
            }
            if (source == null)
            {
                if (!allowSteal) return;
                source = _worldVoices[_worldCursor];
                _worldCursor = (_worldCursor + 1) % _worldVoices.Count;
            }
            source.Stop();
            source.transform.position = position;
            source.clip = clip;
            source.pitch = pitch;
            source.volume = volume;
            source.maxDistance = maxDistance;
            source.Play();
        }

        private AudioClip ShotClip(string weaponId)
        {
            switch (weaponId ?? string.Empty)
            {
                case "shotgun": return _shotgun;
                case "machineGun": return _machineGun;
                case "laserPistol": return _laser;
                case "plasmaRifle": return _plasma;
                case "rocketLauncher": return _rocket;
                case "flamethrower": return _flame;
                case "rifle":
                case "assaultRifle": return _rifle;
                default: return _pistol;
            }
        }

        private void BuildSources()
        {
            _ambience = Source("WastelandAmbience", 0f);
            _ambience.ignoreListenerPause = true;
            _ui = Source("UiAudio", 0f);
            _ui.ignoreListenerPause = true;
            _feet = Source("LocalFootsteps", 0.55f);
            _feet.minDistance = 2f;
            _feet.maxDistance = 18f;
            _feet.rolloffMode = AudioRolloffMode.Linear;
            for (int i = 0; i < WorldVoiceCount; i++)
            {
                AudioSource source = Source("WorldVoice" + i, 0.78f);
                source.minDistance = 2.4f;
                source.maxDistance = 42f;
                source.rolloffMode = AudioRolloffMode.Linear;
                _worldVoices.Add(source);
            }
        }

        private AudioSource Source(string name, float spatialBlend)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var source = go.AddComponent<AudioSource>();
            source.playOnAwake = false;
            source.spatialBlend = spatialBlend;
            source.dopplerLevel = 0f;
            return source;
        }

        private void BuildClips()
        {
            _wind = BuildWind();
            _pistol = BuildGunshot("Pistol", 0.18f, 105f, 0.72f, 0.44f, 0x1173u);
            _rifle = BuildGunshot("Rifle", 0.24f, 78f, 0.88f, 0.56f, 0x23a9u);
            _shotgun = BuildGunshot("Shotgun", 0.34f, 54f, 1f, 0.72f, 0x918bu);
            _machineGun = BuildGunshot("MachineGun", 0.13f, 92f, 0.82f, 0.48f, 0x64d1u);
            _laser = BuildEnergyShot("Laser", 0.23f, 1080f, 250f, 0.08f, 0x2191u);
            _plasma = BuildEnergyShot("Plasma", 0.31f, 430f, 82f, 0.28f, 0xa213u);
            _rocket = BuildGunshot("RocketLaunch", 0.4f, 42f, 0.76f, 0.92f, 0x7731u);
            _flame = BuildWhoosh("Flamethrower", 0.48f, 0x5219u, 0.82f);
            _impact = BuildImpact();
            _explosion = BuildExplosion();
            _meleeSwing = BuildWhoosh("MeleeSwing", 0.24f, 0x85c3u, 0.58f);
            _meleeImpact = BuildThud("MeleeImpact", 0.2f, 72f, 0.7f, 0xd1a3u);
            _hurt = BuildThud("PlayerHurt", 0.27f, 58f, 0.55f, 0x9821u);
            _killConfirm = BuildUiTone("KillConfirm", 0.24f, 620f, 930f);
            _reload = BuildReload();
            _uiClick = BuildUiTone("UiClick", 0.055f, 920f, 680f);
            _panelOpen = BuildUiTone("PanelOpen", 0.16f, 260f, 440f);
            _panelClose = BuildUiTone("PanelClose", 0.14f, 410f, 230f);
            _activityStart = BuildActivitySignal("ActivityStart", 0.42f,
                new[] { 220f, 329.63f, 440f }, 0.035f, 0x3419u);
            _activityProgress = BuildActivitySignal("ActivityProgress", 0.17f,
                new[] { 659.25f, 880f }, 0.012f, 0x7291u);
            _activityExtraction = BuildActivitySignal("ActivityExtraction", 0.5f,
                new[] { 392f, 523.25f, 659.25f }, 0.024f, 0x8723u);
            _activitySuccess = BuildActivitySignal("ActivitySuccess", 0.72f,
                new[] { 392f, 523.25f, 659.25f, 783.99f }, 0.018f, 0x91b7u);
            _activityFailure = BuildActivitySignal("ActivityFailure", 0.64f,
                new[] { 329.63f, 246.94f, 185f, 146.83f }, 0.055f, 0xa529u);
            _steps = new[] { BuildStep("StepA", 0x92a1u, 82f), BuildStep("StepB", 0x5c71u, 96f) };
        }

        private AudioClip BuildWind()
        {
            const float seconds = 8f;
            int frames = Mathf.RoundToInt(seconds * SampleRate);
            var data = new float[frames * 2];
            uint state = 0x81f2a61du;
            float left = 0f;
            float right = 0f;
            for (int i = 0; i < frames; i++)
            {
                float t = i / (float)SampleRate;
                left = Mathf.Lerp(left, Noise(ref state), 0.008f);
                right = Mathf.Lerp(right, Noise(ref state), 0.007f);
                float gust = 0.48f + 0.22f * Mathf.Sin(Mathf.PI * 2f * t / seconds * 3f)
                    + 0.12f * Mathf.Sin(Mathf.PI * 2f * t / seconds * 7f + 1.4f);
                data[i * 2] = Mathf.Clamp(left * gust + Mathf.Sin(Mathf.PI * 2f * 47f * t) * 0.012f, -0.42f, 0.42f);
                data[i * 2 + 1] = Mathf.Clamp(right * gust + Mathf.Sin(Mathf.PI * 2f * 43f * t + 0.8f) * 0.012f, -0.42f, 0.42f);
            }
            int crossFrames = SampleRate / 2;
            for (int i = 0; i < crossFrames; i++)
            {
                float mix = i / (float)crossFrames;
                int tail = frames - crossFrames + i;
                data[tail * 2] = Mathf.Lerp(data[tail * 2], data[i * 2], mix);
                data[tail * 2 + 1] = Mathf.Lerp(data[tail * 2 + 1], data[i * 2 + 1], mix);
            }
            return Store(AudioClip.Create("WastelandWind", frames, 2, SampleRate, false), data);
        }

        private AudioClip BuildGunshot(string name, float seconds, float bodyHz,
                                       float noiseAmount, float bodyAmount, uint seed)
        {
            uint state = seed;
            float filtered = 0f;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                float noise = Noise(ref state);
                filtered = Mathf.Lerp(filtered, noise, 0.24f);
                float crack = (noise * 0.72f + filtered * 0.28f) * Mathf.Exp(-progress * 19f);
                float body = Mathf.Sin(Mathf.PI * 2f * bodyHz * time * (1f - progress * 0.32f))
                    * Mathf.Exp(-progress * 7.2f);
                float tail = filtered * Mathf.Exp(-progress * 4.3f);
                return Mathf.Clamp((crack + tail * 0.34f) * noiseAmount + body * bodyAmount, -0.96f, 0.96f);
            });
        }

        private AudioClip BuildEnergyShot(string name, float seconds, float startHz,
                                          float endHz, float noiseAmount, uint seed)
        {
            uint state = seed;
            float phase = 0f;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                float hz = Mathf.Lerp(startHz, endHz, progress * progress);
                phase += Mathf.PI * 2f * hz / SampleRate;
                float envelope = Mathf.Sin(Mathf.Clamp01(progress / 0.05f) * Mathf.PI * 0.5f)
                    * Mathf.Pow(1f - progress, 1.5f);
                float tone = Mathf.Sin(phase) * 0.64f + Mathf.Sin(phase * 0.503f) * 0.23f;
                return Mathf.Clamp((tone + Noise(ref state) * noiseAmount) * envelope, -0.92f, 0.92f);
            });
        }

        private AudioClip BuildWhoosh(string name, float seconds, uint seed, float strength)
        {
            uint state = seed;
            float low = 0f;
            float previousLow = 0f;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                low = Mathf.Lerp(low, Noise(ref state), Mathf.Lerp(0.06f, 0.22f, progress));
                float band = low - previousLow;
                previousLow = low;
                float envelope = Mathf.Sin(progress * Mathf.PI);
                return Mathf.Clamp(band * 8f * envelope * strength, -0.88f, 0.88f);
            });
        }

        private AudioClip BuildImpact()
        {
            uint state = 0x6da31u;
            return Mono("Impact", 0.14f, (sample, time, progress) =>
            {
                float ring = Mathf.Sin(Mathf.PI * 2f * 680f * time) * Mathf.Exp(-progress * 9f) * 0.34f;
                float grit = Noise(ref state) * Mathf.Exp(-progress * 13f) * 0.58f;
                return Mathf.Clamp(ring + grit, -0.9f, 0.9f);
            });
        }

        private AudioClip BuildExplosion()
        {
            uint state = 0x173ab9u;
            float low = 0f;
            return Mono("Explosion", 0.92f, (sample, time, progress) =>
            {
                low = Mathf.Lerp(low, Noise(ref state), 0.045f);
                float blast = low * Mathf.Exp(-progress * 3.7f) * 0.9f;
                float sub = Mathf.Sin(Mathf.PI * 2f * Mathf.Lerp(58f, 31f, progress) * time)
                    * Mathf.Exp(-progress * 4.6f) * 0.64f;
                float crack = Noise(ref state) * Mathf.Exp(-progress * 22f) * 0.72f;
                return Mathf.Clamp(blast + sub + crack, -0.98f, 0.98f);
            });
        }

        private AudioClip BuildThud(string name, float seconds, float hz, float grit, uint seed)
        {
            uint state = seed;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                float envelope = Mathf.Exp(-progress * 6.5f);
                float body = Mathf.Sin(Mathf.PI * 2f * hz * time * (1f - progress * 0.3f));
                return Mathf.Clamp((body * 0.72f + Noise(ref state) * grit * 0.28f) * envelope, -0.92f, 0.92f);
            });
        }

        private AudioClip BuildStep(string name, uint seed, float hz)
        {
            uint state = seed;
            float dust = 0f;
            return Mono(name, 0.17f, (sample, time, progress) =>
            {
                dust = Mathf.Lerp(dust, Noise(ref state), 0.18f);
                float envelope = Mathf.Sin(Mathf.Clamp01(progress / 0.12f) * Mathf.PI * 0.5f)
                    * Mathf.Exp(-progress * 5.8f);
                float sole = Mathf.Sin(Mathf.PI * 2f * hz * time) * 0.42f;
                return Mathf.Clamp((dust * 0.68f + sole) * envelope, -0.78f, 0.78f);
            });
        }

        private AudioClip BuildReload()
        {
            uint state = 0xb379u;
            return Mono("Reload", 0.36f, (sample, time, progress) =>
            {
                float first = Pulse(time, 0.035f, 0.018f);
                float second = Pulse(time, 0.18f, 0.024f);
                float latch = Pulse(time, 0.31f, 0.016f);
                float tone = Mathf.Sin(Mathf.PI * 2f * (520f + progress * 160f) * time);
                return Mathf.Clamp((first * 0.7f + second + latch * 0.86f)
                    * (tone * 0.55f + Noise(ref state) * 0.34f), -0.82f, 0.82f);
            });
        }

        private AudioClip BuildActivitySignal(string name, float seconds, float[] notes,
                                              float noiseAmount, uint seed)
        {
            float phase = 0f;
            uint state = seed;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                float notePosition = progress * notes.Length;
                int noteIndex = Mathf.Min(notes.Length - 1, Mathf.FloorToInt(notePosition));
                float local = notePosition - noteIndex;
                float attack = Mathf.Sin(Mathf.Clamp01(local / 0.12f) * Mathf.PI * 0.5f);
                float release = Mathf.Pow(Mathf.Clamp01(1f - local), 1.15f);
                float global = Mathf.Sin(Mathf.Clamp01(progress / 0.035f) * Mathf.PI * 0.5f)
                    * Mathf.Pow(1f - progress, 0.22f);
                phase += Mathf.PI * 2f * notes[noteIndex] / SampleRate;
                float tone = Mathf.Sin(phase) * 0.62f + Mathf.Sin(phase * 2.005f + 0.23f) * 0.18f;
                return Mathf.Clamp((tone + Noise(ref state) * noiseAmount)
                    * attack * release * global, -0.86f, 0.86f);
            });
        }
        private AudioClip BuildUiTone(string name, float seconds, float startHz, float endHz)
        {
            float phase = 0f;
            return Mono(name, seconds, (sample, time, progress) =>
            {
                phase += Mathf.PI * 2f * Mathf.Lerp(startHz, endHz, progress) / SampleRate;
                float envelope = Mathf.Sin(Mathf.Clamp01(progress / 0.08f) * Mathf.PI * 0.5f)
                    * Mathf.Pow(1f - progress, 2.2f);
                return Mathf.Sin(phase) * envelope * 0.58f;
            });
        }

        private delegate float SampleSynth(int sample, float time, float progress);

        private AudioClip Mono(string name, float seconds, SampleSynth synth)
        {
            int count = Mathf.Max(1, Mathf.RoundToInt(seconds * SampleRate));
            var data = new float[count];
            for (int i = 0; i < count; i++)
                data[i] = synth(i, i / (float)SampleRate, i / (float)Mathf.Max(1, count - 1));
            return Store(AudioClip.Create(name, count, 1, SampleRate, false), data);
        }

        private AudioClip Store(AudioClip clip, float[] data)
        {
            float peak = 0f;
            for (int i = 0; i < data.Length; i++)
            {
                if (float.IsNaN(data[i]) || float.IsInfinity(data[i]))
                    throw new InvalidOperationException("Generated audio contains a non-finite sample: " + clip.name);
                peak = Mathf.Max(peak, Mathf.Abs(data[i]));
            }
            if (peak < 0.005f)
                throw new InvalidOperationException("Generated audio is silent: " + clip.name);

            clip.SetData(data, 0);
            _clips.Add(clip);
            _validatedClipCount++;
            return clip;
        }

        private float Pitch(float min, float max)
        {
            return Mathf.Lerp(min, max, NextVariation());
        }

        private float NextVariation()
        {
            _variationState = _variationState * 1664525u + 1013904223u;
            return ((_variationState >> 8) & 0xffffu) / 65535f;
        }

        private static float Noise(ref uint state)
        {
            state = state * 1664525u + 1013904223u;
            return (((state >> 8) & 0xffffu) / 32767.5f) - 1f;
        }

        private static float Pulse(float time, float center, float width)
        {
            float distance = Mathf.Abs(time - center) / Mathf.Max(0.001f, width);
            return distance >= 1f ? 0f : 1f - distance;
        }
    }
}
