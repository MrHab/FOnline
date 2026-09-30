using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Погода текущей комнаты на клиенте (kromka.weather.v1, src/server/weather.js).
    /// Снимок приходит с сервера: при входе — полем weather состояния комнаты, дальше —
    /// событием weatherState. Здесь он сглаживается и раздаётся тем, кто рисует и
    /// звучит: свету и земле (RoaWorldLighting), дождю (RoaRainFx), шуму дождя и грому
    /// (RoaAudio), брызгам из-под ног (RoaMovementFx). Правила считает сервер; клиент
    /// повторяет только множитель скорости пешком, чтобы предсказанный шаг совпадал с
    /// бюджетом сервера и персонажа не откатывало.
    /// </summary>
    public sealed class RoaWeather : MonoBehaviour
    {
        /// <summary>С этой грязи чип под картой напоминает о ней и после дождя.</summary>
        public const float MudChipThreshold = 0.25f;
        /// <summary>Молнии бьют, пока сглаженный ливень не ослаб ниже этого.</summary>
        public const float LightningRain = 0.5f;

        public struct Snapshot
        {
            public bool Valid;
            public string State;
            public float Rain;
            public float Cloud;
            public float Wetness;
            public float Mud;
            public float Puddles;
            public Vector2 Wind;
            public float WindSpeed;
            public bool Sheltered;
            public bool Forced;
            public float MoveSpeedMultiplier;
            public float HearingMultiplier;
            public float VisionMultiplier;
            public float RangedAccuracyMultiplier;
        }

        public RoaWorldLighting Lighting;
        public RoaAudio Audio;
        public RoaMovementFx MovementFx;
        public RoaCombat Combat;
        public Camera ViewCamera;

        private RoaRainFx _rainFx;
        private Snapshot _target;
        private bool _active;
        private bool _snapNext = true;
        private float _nextLightningAt = float.PositiveInfinity;
        private float _flashStartedAt = float.NegativeInfinity;
        private float _flashStrength;
        private float _thunderAt = float.PositiveInfinity;
        private float _thunderDistance;
        private uint _random = 0x6d2b79f5u;

        public Snapshot Target { get { return _target; } }
        public bool Active { get { return _active; } }
        public float Rain { get; private set; }
        public float Cloud { get; private set; }
        public float Wetness { get; private set; }
        public float Mud { get; private set; }
        public float Puddles { get; private set; }
        public RoaRainFx RainFx { get { return _rainFx; } }
        public int LightningCount { get; private set; }
        /// <summary>Идёт ливень, и следующий удар уже назначен.</summary>
        public bool LightningScheduled { get { return !float.IsPositiveInfinity(_nextLightningAt); } }

        /// <summary>Множитель скорости пешком, тот же, что режет бюджет шага на сервере.</summary>
        public float MoveSpeedMultiplier
        {
            get { return _active && _target.Valid ? Mathf.Clamp(_target.MoveSpeedMultiplier, 0.5f, 1f) : 1f; }
        }

        /// <summary>Чип под миникартой: только когда погода меняет игру. Пусто — чипа нет.</summary>
        public string ChipLabel
        {
            get
            {
                if (!_active || !_target.Valid || _target.Sheltered) return string.Empty;
                if (_target.State == "storm") return "ЛИВЕНЬ";
                if (_target.State == "rain") return "ДОЖДЬ";
                return _target.Mud >= MudChipThreshold ? "ГРЯЗЬ" : string.Empty;
            }
        }

        public static Snapshot Parse(JObject weather)
        {
            var snapshot = new Snapshot { Valid = false, State = "clear", MoveSpeedMultiplier = 1f, HearingMultiplier = 1f,
                                          VisionMultiplier = 1f, RangedAccuracyMultiplier = 1f };
            if (weather == null) return snapshot;
            snapshot.Valid = true;
            snapshot.State = weather["state"]?.ToString() ?? "clear";
            snapshot.Rain = Unit(weather["rain"]);
            snapshot.Cloud = Unit(weather["cloud"]);
            snapshot.Wetness = Unit(weather["wetness"]);
            snapshot.Mud = Unit(weather["mud"]);
            snapshot.Puddles = Unit(weather["puddles"]);
            snapshot.Sheltered = weather["sheltered"]?.Type == JTokenType.Boolean && weather["sheltered"].Value<bool>();
            snapshot.Forced = weather["forced"]?.Type == JTokenType.Boolean && weather["forced"].Value<bool>();
            if (weather["wind"] is JObject wind)
            {
                var direction = new Vector2(Number(wind["x"], 1f), Number(wind["z"], 0f));
                snapshot.Wind = direction.sqrMagnitude > 0.0001f ? direction.normalized : Vector2.right;
                snapshot.WindSpeed = Unit(wind["speed"]);
            }
            else
            {
                snapshot.Wind = Vector2.right;
            }
            JObject effects = weather["effects"] as JObject;
            snapshot.MoveSpeedMultiplier = Multiplier(effects?["moveSpeedMultiplier"]);
            snapshot.HearingMultiplier = Multiplier(effects?["hearingMultiplier"]);
            snapshot.VisionMultiplier = Multiplier(effects?["visionMultiplier"]);
            snapshot.RangedAccuracyMultiplier = Multiplier(effects?["rangedAccuracyMultiplier"]);
            return snapshot;
        }

        /// <summary>Строка журнала при смене погоды (по состоянию сервера); пусто — сообщать нечего.</summary>
        public static string TransitionNotice(Snapshot previous, Snapshot next)
        {
            if (!next.Valid || next.Sheltered) return string.Empty;
            bool wasStorm = previous.Valid && !previous.Sheltered && previous.State == "storm";
            bool wasRaining = wasStorm || (previous.Valid && !previous.Sheltered && previous.State == "rain");
            bool storm = next.State == "storm";
            bool raining = storm || next.State == "rain";
            if (storm && !wasStorm)
                return "Ливень: враги почти не слышат шагов, видят и стреляют хуже.";
            if (raining && !wasRaining)
                return "Начался дождь: шаги тише, обзор врагов короче, прицел хуже.";
            if (!raining && wasRaining)
                return next.Mud >= MudChipThreshold
                    ? "Дождь кончился. Грязь замедляет шаг, пока земля не высохнет."
                    : "Дождь кончился.";
            return string.Empty;
        }

        /// <summary>Огибающая вспышки молнии: яркий удар, короткий провал и второй, слабее.</summary>
        public static float LightningEnvelope(float seconds)
        {
            if (seconds < 0f || seconds > 0.55f) return 0f;
            if (seconds < 0.04f) return seconds / 0.04f;
            if (seconds < 0.12f) return Mathf.Lerp(1f, 0.15f, (seconds - 0.04f) / 0.08f);
            if (seconds < 0.17f) return Mathf.Lerp(0.15f, 0.7f, (seconds - 0.12f) / 0.05f);
            return Mathf.Lerp(0.7f, 0f, (seconds - 0.17f) / 0.38f);
        }

        /// <summary>Погода из состояния комнаты (вход, смена локации).</summary>
        public void ApplyWorldState(JObject state)
        {
            if (state?["weather"] is JObject weather) Apply(weather);
        }

        /// <summary>Снимок погоды с сервера (weatherState или worldState.weather).</summary>
        public void Apply(JObject weather)
        {
            Snapshot next = Parse(weather);
            if (!next.Valid) return;
            if (_active && !_snapNext)
            {
                string notice = TransitionNotice(_target, next);
                if (!string.IsNullOrEmpty(notice)) Combat?.AnnounceWorld(notice, new Color(0.62f, 0.78f, 0.95f));
            }
            _target = next;
            if (_snapNext)
            {
                _snapNext = false;
                SnapToTarget();
            }
        }

        /// <summary>Вход в локальный мир и выход из него. Новая комната — погода сразу, без перетекания.</summary>
        public void SetActive(bool active)
        {
            _active = active;
            _snapNext = true;
            if (active) return;
            _target = default(Snapshot);
            Rain = Cloud = Wetness = Mud = Puddles = 0f;
            _thunderAt = float.PositiveInfinity;
            _nextLightningAt = float.PositiveInfinity;
            Push(0f);
        }

        private void Awake()
        {
            EnsureRainFx();
        }

        private void EnsureRainFx()
        {
            if (_rainFx != null) return;
            var child = new GameObject("RainFx");
            child.transform.SetParent(transform, false);
            _rainFx = child.AddComponent<RoaRainFx>();
        }

        private void SnapToTarget()
        {
            bool outside = _target.Valid && !_target.Sheltered;
            Rain = outside ? _target.Rain : 0f;
            Cloud = outside ? _target.Cloud : 0f;
            Wetness = outside ? _target.Wetness : 0f;
            Mud = outside ? _target.Mud : 0f;
            Puddles = outside ? _target.Puddles : 0f;
        }

        private void Update()
        {
            if (!_active) return;
            float dt = Mathf.Max(0f, Time.deltaTime);
            bool outside = _target.Valid && !_target.Sheltered;
            // Дождь набирает силу и стихает за секунды, земля мокнет и сохнет медленнее.
            Rain = Mathf.MoveTowards(Rain, outside ? _target.Rain : 0f, dt * 0.22f);
            Cloud = Mathf.MoveTowards(Cloud, outside ? _target.Cloud : 0f, dt * 0.12f);
            Wetness = Mathf.MoveTowards(Wetness, outside ? _target.Wetness : 0f, dt * 0.08f);
            Mud = Mathf.MoveTowards(Mud, outside ? _target.Mud : 0f, dt * 0.06f);
            Puddles = Mathf.MoveTowards(Puddles, outside ? _target.Puddles : 0f, dt * 0.06f);
            UpdateLightning();
            Push(dt);
        }

        private void Push(float dt)
        {
            Lighting?.SetRain(Cloud, Rain, Wetness);
            Audio?.SetRain(_target.Valid ? _target.Rain : 0f, _target.Sheltered);
            MovementFx?.SetGround(Wetness, Mud);
            EnsureRainFx();
            if (ViewCamera == null) ViewCamera = Camera.main;
            _rainFx.SetWeather(Rain, Wetness, _target.Wind, _target.WindSpeed, ViewCamera);
        }

        private void UpdateLightning()
        {
            float now = Time.time;
            bool storm = _target.State == "storm" && !_target.Sheltered && Rain >= LightningRain;
            if (!storm)
            {
                _nextLightningAt = float.PositiveInfinity;
            }
            else if (float.IsPositiveInfinity(_nextLightningAt))
            {
                _nextLightningAt = now + Mathf.Lerp(4f, 12f, Next01());
            }
            else if (now >= _nextLightningAt)
            {
                // Чем ближе удар, тем ярче вспышка и тем скорее за ней гром.
                _thunderDistance = Next01();
                _flashStrength = Mathf.Lerp(1f, 0.35f, _thunderDistance);
                _flashStartedAt = now;
                _thunderAt = now + Mathf.Lerp(0.25f, 3.2f, _thunderDistance);
                _nextLightningAt = now + Mathf.Lerp(9f, 26f, Next01()) / Mathf.Max(0.5f, Rain);
                LightningCount++;
            }

            float flash = LightningEnvelope(now - _flashStartedAt) * _flashStrength;
            Lighting?.SetLightningFlash(flash);
            _rainFx?.SetFlash(flash);
            if (now >= _thunderAt)
            {
                _thunderAt = float.PositiveInfinity;
                Audio?.PlayThunder(_thunderDistance);
            }
        }

        /// <summary>
        /// Удар молнии сейчас, сразу на пике вспышки (для проб и отладки): кадр
        /// снимается в том же кадре, что бы ни было с частотой кадров.
        /// </summary>
        public void TriggerLightning(float distance)
        {
            _thunderDistance = Mathf.Clamp01(distance);
            _flashStrength = Mathf.Lerp(1f, 0.35f, _thunderDistance);
            _flashStartedAt = Time.time - 0.04f;
            _thunderAt = Time.time + Mathf.Lerp(0.25f, 3.2f, _thunderDistance);
            LightningCount++;
            float flash = LightningEnvelope(0.04f) * _flashStrength;
            Lighting?.SetLightningFlash(flash);
            _rainFx?.SetFlash(flash);
        }

        private float Next01()
        {
            _random ^= _random << 13;
            _random ^= _random >> 17;
            _random ^= _random << 5;
            return (_random & 0x00ffffffu) / 16777215f;
        }

        private static float Unit(JToken token)
        {
            return Mathf.Clamp01(Number(token, 0f));
        }

        private static float Multiplier(JToken token)
        {
            return Mathf.Clamp(Number(token, 1f), 0.5f, 1f);
        }

        private static float Number(JToken token, float fallback)
        {
            if (token == null || (token.Type != JTokenType.Float && token.Type != JTokenType.Integer)) return fallback;
            float value = token.Value<float>();
            return float.IsNaN(value) || float.IsInfinity(value) ? fallback : value;
        }
    }
}
