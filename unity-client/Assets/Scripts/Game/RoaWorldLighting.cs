using System.Collections;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Local-world lighting ported from 02b_lighting_time.js. The shipped web client
    /// deliberately keeps the clock at 16:12, so Unity does the same by default.
    /// Server time can be enabled for diagnostics or a future live cycle without
    /// changing the authoritative Node simulation.
    /// </summary>
    public sealed partial class RoaWorldLighting : MonoBehaviour
    {
        public const float WebFixedWorldHour = 16.2f;
        private const float GameDayRealSeconds = 60f * 60f;
        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int ColorId = Shader.PropertyToID("_Color");
        private static readonly int SmoothnessId = Shader.PropertyToID("_Smoothness");
        private static readonly int GlossinessId = Shader.PropertyToID("_Glossiness");
        private static readonly int WetnessId = Shader.PropertyToID("_Wetness");
        private static readonly int PuddlesId = Shader.PropertyToID("_Puddles");
        private static readonly int MudId = Shader.PropertyToID("_Mud");
        private static readonly int RainId = Shader.PropertyToID("_Rain");

        /// <summary>Гладкость сухой земли — та же, что ставит ей RoaLocalTerrain.</summary>
        public const float DryGroundSmoothness = 0.015f;
        public const float WetGroundSmoothness = 0.52f;
        /// <summary>Во сколько раз темнеет насквозь мокрая земля: вода заполняет поры.</summary>
        public const float WetGroundDarkening = 0.68f;
        /// <summary>
        /// Верх коробки отражения мокрой земли над полом, м. Проба отдаёт небо тем
        /// рендерам, чей центр ниже: самой земле и мелкому щебню, но не постройкам,
        /// кустам и персонажам — они отражают прежнее окружение сцены.
        /// </summary>
        public const float WetReflectionTop = 0.05f;
        private const int SkyCubeSize = 16;

        [Header("Clock")]
        [Tooltip("Matches the current web client when disabled. When enabled, reads worldHour from /api/wasteland.")]
        public bool FollowServerWorldHour;

        [Range(0f, 24f)] public float FixedWorldHour = WebFixedWorldHour;
        [Min(2f)] public float ServerPollSeconds = 10f;

        [Header("Scene lights")]
        public Light Sun;
        public Light Moon;
        public Light ReliefRim;

        public float WorldHour { get; private set; }
        public string HourSource { get; private set; } = "web-fixed";
        public string VisualProfileId { get; private set; } = "default";
        public LightingSample CurrentSample { get; private set; }
        public bool LocalWorldActive { get { return _localWorldActive; } }
        public float WeatherCloud { get { return _weatherCloud; } }
        public float WeatherRain { get { return _weatherRain; } }
        public float GroundWetness { get { return _groundWetness; } }
        public float GroundPuddles { get { return _groundPuddles; } }
        public float GroundMud { get { return _groundMud; } }
        public float LightningFlash { get { return _lightningFlash; } }
        public Light LightningLight { get { return _lightning; } }
        public ReflectionProbe WetReflection { get { return _wetReflection; } }

        public struct LightingSample
        {
            public float Hour;
            public float SunAltitude;
            public float Daylight;
            public float Twilight;
            public float Night;
            public float MoonAmount;
            public float SunIntensity;
            public float MoonIntensity;
            public float RimIntensity;
            public float HemiIntensity;
            public float FillIntensity;
            public float FogDensity;
            public float Exposure;
            public float GroundTintMix;
            public bool SunShadows;
            public Color SkyColor;
            public Color FogColor;
            public Color HemiSkyColor;
            public Color HemiGroundColor;
            public Color FillColor;
            public Color SunColor;
            public Color MoonColor;
            public Color RimColor;
        }

        private string _baseUrl = "http://127.0.0.1:3000";
        private LocationDefinition _location;
        private JObject _effectiveProfile;
        private Renderer _groundRenderer;
        private MaterialPropertyBlock _groundTint;
        private Color _groundDayColor = Color.white;
        private float _groundDrySmoothness = DryGroundSmoothness;
        private bool _localWorldActive;
        private bool _sceneStateCaptured;
        private bool _ownsSun;
        private Coroutine _clockPoll;
        private bool _hasServerClock;
        private double _serverHourAtSync;
        private float _serverSyncRealtime;
        private float _lastApplyRealtime = float.NegativeInfinity;
        private float _lastRequestedHour = float.NaN;
        private string _lastPollError = string.Empty;
        private float _weatherCloud;
        private float _weatherRain;
        private float _groundWetness;
        private float _groundPuddles;
        private float _groundMud;
        private float _lightningFlash;
        private float _lastWeatherApplyRealtime = float.NegativeInfinity;
        private float _appliedExposure = 1f;
        private Light _lightning;
        private ReflectionProbe _wetReflection;
        private Cubemap _skyCube;

        private bool _initialFog;
        private Color _initialFogColor;
        private FogMode _initialFogMode;
        private float _initialFogDensity;
        private AmbientMode _initialAmbientMode;
        private Color _initialAmbientSky;
        private Color _initialAmbientEquator;
        private Color _initialAmbientGround;
        private float _initialAmbientIntensity;
        private float _initialReflectionIntensity;
        private Light _initialRenderSun;

        private bool _sunStateCaptured;
        private bool _initialSunEnabled;
        private Color _initialSunColor;
        private float _initialSunIntensity;
        private LightShadows _initialSunShadows;
        private Quaternion _initialSunRotation;

        private Camera _camera;
        private bool _cameraStateCaptured;
        private CameraClearFlags _initialClearFlags;
        private Color _initialBackground;
        private Volume _postVolume;
        private VolumeProfile _runtimeVolumeProfile;
        private ColorAdjustments _colorAdjustments;
        private Vignette _vignette;
        private Bloom _bloom;
        private Tonemapping _tonemapping;
        private UniversalAdditionalCameraData _cameraData;
        private bool _cameraPostStateCaptured;
        private bool _initialRenderPostProcessing;

        private void Awake()
        {
            CaptureSceneState();
            EnsureLights();
        }

        private void OnDisable()
        {
            StopClockPoll();
        }

        private void OnDestroy()
        {
            RestoreGround();
            RestoreSceneState();
            if (_postVolume != null) DestroyRuntime(_postVolume.gameObject);
            if (_runtimeVolumeProfile != null) DestroyRuntime(_runtimeVolumeProfile);
            if (_stormVolume != null) DestroyRuntime(_stormVolume.gameObject);
            if (_stormProfile != null) DestroyRuntime(_stormProfile);
            if (_ownsSun && Sun != null) DestroyRuntime(Sun.gameObject);
            if (_wetReflection != null) DestroyRuntime(_wetReflection.gameObject);
            if (_skyCube != null) DestroyRuntime(_skyCube);
        }

        private void Update()
        {
            if (!_localWorldActive) return;
            ApplyLightningFlash();

            if (FollowServerWorldHour)
            {
                if (_clockPoll == null) _clockPoll = StartCoroutine(PollServerClock());
            }
            else
            {
                StopClockPoll();
                _hasServerClock = false;
            }

            if (Time.unscaledTime - _lastApplyRealtime < 1f) return;
            ApplyCurrentHour(false);
        }

        public void Configure(string baseUrl)
        {
            if (!string.IsNullOrWhiteSpace(baseUrl)) _baseUrl = baseUrl.TrimEnd('/');
        }

        public void SetLocation(LocationDefinition location, Renderer groundRenderer)
        {
            RestoreGround();
            _location = location;
            _effectiveProfile = ResolveVisualProfile(location);
            _groundRenderer = groundRenderer;
            if (_groundRenderer != null && _groundRenderer.sharedMaterial != null)
            {
                _groundDayColor = ReadMaterialColor(_groundRenderer.sharedMaterial);
                // Сухая гладкость — своя у материала земли: в ясную кадр обязан совпадать с прежним.
                _groundDrySmoothness = _groundRenderer.sharedMaterial.HasProperty(SmoothnessId)
                    ? _groundRenderer.sharedMaterial.GetFloat(SmoothnessId) : DryGroundSmoothness;
            }

            VisualProfileId = _effectiveProfile?["id"]?.ToString() ?? "default";
            ApplyCurrentHour(true);
        }

        /// <summary>
        /// Дождь поверх часа (RoaWeather): облака гасят солнце и тени, дождь
        /// сгущает дымку, мокрая земля темнеет и блестит. Входит в CurrentSample,
        /// поэтому буря выброса (SetWeather, .Weather) ложится уже поверх дождя.
        /// Лужи и грязь уходят шейдеру земли (Kromka Ground). Вызывается каждый кадр
        /// сглаженными числами; свет пересчитывается не чаще четырёх раз в секунду.
        /// </summary>
        public void SetRain(float cloud, float rain, float wetness, float puddles = 0f, float mud = 0f)
        {
            cloud = Mathf.Clamp01(cloud);
            rain = Mathf.Clamp01(rain);
            wetness = Mathf.Clamp01(wetness);
            puddles = Mathf.Clamp01(puddles);
            mud = Mathf.Clamp01(mud);
            float change = Mathf.Max(Mathf.Max(Mathf.Abs(cloud - _weatherCloud), Mathf.Abs(rain - _weatherRain)),
                Mathf.Max(Mathf.Abs(wetness - _groundWetness),
                    Mathf.Max(Mathf.Abs(puddles - _groundPuddles), Mathf.Abs(mud - _groundMud))));
            if (change <= 0f) return;
            _weatherCloud = cloud;
            _weatherRain = rain;
            _groundWetness = wetness;
            _groundPuddles = puddles;
            _groundMud = mud;
            bool settled = cloud <= 0f && rain <= 0f && wetness <= 0f && puddles <= 0f && mud <= 0f;
            if (!settled && change < 0.02f && Time.unscaledTime - _lastWeatherApplyRealtime < 0.25f) return;
            _lastWeatherApplyRealtime = Time.unscaledTime;
            ApplyCurrentHour(true);
        }

        /// <summary>Вспышка молнии 0..1: на миг пересвечивает кадр поверх экспозиции часа.</summary>
        public void SetLightningFlash(float amount)
        {
            _lightningFlash = Mathf.Clamp01(amount);
            if (_localWorldActive) ApplyLightningFlash();
        }

        public void SetLocalWorldActive(bool active)
        {
            _localWorldActive = active;
            EnsureLights();
            if (active)
            {
                ApplyCurrentHour(true);
                if (FollowServerWorldHour && _clockPoll == null)
                    _clockPoll = StartCoroutine(PollServerClock());
                return;
            }

            StopClockPoll();
            RestoreGround();
            RestoreSceneState();
            if (_postVolume != null) _postVolume.enabled = false;
            if (Sun != null) Sun.enabled = false;
            if (Moon != null) Moon.enabled = false;
            if (ReliefRim != null) ReliefRim.enabled = false;
            if (_lightning != null) _lightning.enabled = false;
            if (_wetReflection != null) _wetReflection.enabled = false;
        }

        /// <summary>Pure version of the web formula, also used by the editor probe.</summary>
        public static LightingSample Evaluate(float hour, JObject profile = null, bool mobile = false)
        {
            hour = NormalizeHour(hour);
            float sunAltitude = Mathf.Sin((hour - 6f) / 24f * Mathf.PI * 2f);
            float daylight = Smooth01((sunAltitude + 0.18f) / 0.83f);
            float twilight = Mathf.Clamp01(
                Smooth01(1f - Mathf.Abs(hour - 6f) / 2.2f)
                + Smooth01(1f - Mathf.Abs(hour - 18f) / 2.2f));
            float night = 1f - daylight;
            float moonAmount = Smooth01((0.16f - sunAltitude) / 0.46f);

            Color sky = Color.Lerp(ProfileColor(profile, "skyNight", 0x34394a),
                                   ProfileColor(profile, "skyDay", 0x56616a), daylight);
            sky = Color.Lerp(sky, ProfileColor(profile, "skyDawn", 0x775033), twilight * 0.28f);

            Color fog = Color.Lerp(ProfileColor(profile, "fogNight", 0x394058),
                                   ProfileColor(profile, "fogDay", 0x62594f), daylight);
            fog = Color.Lerp(fog, ProfileColor(profile, "fogDawn", 0x765031), twilight * 0.24f);

            Color hemiSky = Color.Lerp(ProfileColor(profile, "hemiSkyNight", 0xc9d7ff),
                                       ProfileColor(profile, "hemiSkyDay", 0xd6cec0), daylight);
            hemiSky = Color.Lerp(hemiSky, ProfileColor(profile, "hemiSkyDawn", 0xe2a66f), twilight * 0.35f);
            Color hemiGround = Color.Lerp(ProfileColor(profile, "hemiGroundNight", 0x84745e),
                                          ProfileColor(profile, "hemiGroundDay", 0x756757), daylight);

            Color fill = Color.Lerp(ProfileColor(profile, "fillNight", 0xc2d0ff),
                                    ProfileColor(profile, "fillDay", 0xe3d3bc), daylight);
            fill = Color.Lerp(fill, ProfileColor(profile, "fillDawn", 0xf1bb7c), twilight * 0.22f);

            Color sun = Color.Lerp(ProfileColor(profile, "sunNight", 0xffdfad),
                                   ProfileColor(profile, "sunDay", 0xffdfad), daylight);
            sun = Color.Lerp(sun, ProfileColor(profile, "sunDawn", 0xffa866), twilight * 0.55f);
            Color moon = ProfileColor(profile, "moonNight", 0x9db8ff);
            Color rimTarget = ProfileColor(profile, "rimDay", sun);
            Color rim = Color.Lerp(moon, rimTarget, Mathf.Max(0.18f, daylight));

            float hemiIntensity = (Mathf.Lerp(mobile ? 0.60f : 0.50f, 0.55f, daylight) + twilight * 0.025f)
                                  * ProfileNumber(profile, "hemiIntensityScale", 1f, 0.2f, 2f);
            float fillIntensity = (Mathf.Lerp(mobile ? 0.38f : 0.32f, 0.18f, daylight) + twilight * 0.02f)
                                  * ProfileNumber(profile, "fillIntensityScale", 1f, 0.15f, 2f);
            float sunIntensity = (Mathf.Lerp(0f, 1.05f, daylight) + twilight * 0.06f)
                                 * ProfileNumber(profile, "sunIntensityScale", 1f, 0.2f, 2f);
            float moonIntensity = Mathf.Lerp(0f, mobile ? 0.46f : 0.38f, moonAmount);
            float rimIntensity = (Mathf.Lerp(mobile ? 0.15f : 0.12f, 0.18f, daylight) + twilight * 0.02f)
                                 * ProfileNumber(profile, "rimIntensityScale", 1f, 0.15f, 2f);

            float fogNight = ProfileNumber(profile, "fogDensityNight", mobile ? 0.00175f : 0.00205f, 0f, 0.02f);
            float fogDay = ProfileNumber(profile, "fogDensityDay", 0.0022f, 0f, 0.02f);
            float exposureNight = ProfileNumber(profile, "exposureNight", mobile ? 1.16f : 1.10f, 0.5f, 2f);
            float exposureDay = ProfileNumber(profile, "exposureDay", mobile ? 1.07f : 1.04f, 0.5f, 2f);
            float tintMix = Mathf.Clamp(Smooth01(night) * 0.58f - twilight * 0.18f, 0f, 0.68f);

            return new LightingSample
            {
                Hour = hour,
                SunAltitude = sunAltitude,
                Daylight = daylight,
                Twilight = twilight,
                Night = night,
                MoonAmount = moonAmount,
                SunIntensity = sunIntensity,
                MoonIntensity = moonIntensity,
                RimIntensity = rimIntensity,
                HemiIntensity = hemiIntensity,
                FillIntensity = fillIntensity,
                FogDensity = Mathf.Lerp(fogNight, fogDay, daylight) + twilight * 0.00010f,
                Exposure = Mathf.Lerp(exposureNight, exposureDay, daylight) + twilight * 0.015f,
                GroundTintMix = tintMix,
                SunShadows = Smooth01(daylight) > 0.22f,
                SkyColor = sky,
                FogColor = fog,
                HemiSkyColor = hemiSky,
                HemiGroundColor = hemiGround,
                FillColor = fill,
                SunColor = sun,
                MoonColor = moon,
                RimColor = rim
            };
        }

        private void ApplyCurrentHour(bool force)
        {
            float hour = FixedWorldHour;
            HourSource = "web-fixed";
            if (FollowServerWorldHour && _hasServerClock)
            {
                double elapsed = Mathf.Max(0f, Time.realtimeSinceStartup - _serverSyncRealtime);
                hour = (float)(_serverHourAtSync + elapsed / GameDayRealSeconds * 24d);
                HourSource = "server";
            }

            hour = NormalizeHour(hour);
            if (!force && Mathf.Abs(Mathf.DeltaAngle(_lastRequestedHour * 15f, hour * 15f)) < 0.001f)
            {
                _lastApplyRealtime = Time.unscaledTime;
                return;
            }
            _lastRequestedHour = hour;
            Apply(WithWeather(Evaluate(hour, _effectiveProfile, Application.isMobilePlatform),
                _weatherCloud, _weatherRain));
        }

        /// <summary>
        /// Погода поверх расчёта часа — чистая функция, её проверяет проба. В
        /// сплошной облачности свет рассеянный: солнце слабое и без теней, небо и
        /// дымка серые, а дождь сгущает дымку так, что дальний край кадра тонет.
        /// </summary>
        public static LightingSample WithWeather(LightingSample sample, float cloud, float rain)
        {
            cloud = Mathf.Clamp01(cloud);
            rain = Mathf.Clamp01(rain);
            if (cloud <= 0f && rain <= 0f) return sample;
            float light = Mathf.Lerp(0.5f, 1f, sample.Daylight);
            sample.SunIntensity *= 1f - 0.68f * cloud;
            sample.RimIntensity *= 1f - 0.4f * cloud;
            sample.SunShadows = sample.SunShadows && cloud < 0.72f;
            sample.HemiIntensity *= 1f + 0.08f * cloud;
            sample.FillIntensity *= 1f + 0.25f * cloud;
            sample.SkyColor = Color.Lerp(sample.SkyColor, new Color(0.29f, 0.31f, 0.34f) * light, cloud * 0.8f);
            sample.FogColor = Color.Lerp(sample.FogColor, new Color(0.37f, 0.39f, 0.41f) * light, cloud * 0.75f);
            sample.HemiSkyColor = Color.Lerp(sample.HemiSkyColor, new Color(0.72f, 0.76f, 0.80f), cloud * 0.6f);
            sample.SunColor = Color.Lerp(sample.SunColor, new Color(0.86f, 0.89f, 0.93f), cloud * 0.7f);
            sample.FogDensity += 0.0025f * cloud + 0.016f * rain;
            // Под сплошной облачностью темнеет всё, а не только мокрая земля.
            sample.Exposure *= 1f - 0.18f * cloud;
            return sample;
        }

        /// <summary>Цвет и гладкость земли при данной влажности, от сухого цвета и сухой гладкости материала.</summary>
        public static void WetGround(Color dry, float drySmoothness, float wetness, out Color color, out float smoothness)
        {
            wetness = Mathf.Clamp01(wetness);
            float darken = Mathf.Lerp(1f, WetGroundDarkening, wetness);
            color = new Color(dry.r * darken, dry.g * darken, dry.b * darken, dry.a);
            // Блеск приходит раньше потемнения: тонкая плёнка воды уже отражает.
            smoothness = Mathf.Lerp(drySmoothness, Mathf.Max(drySmoothness, WetGroundSmoothness), Mathf.Sqrt(wetness));
        }

        private void Apply(LightingSample sample)
        {
            CurrentSample = sample;
            WorldHour = sample.Hour;
            _lastApplyRealtime = Time.unscaledTime;
            if (!_localWorldActive) return;

            EnsureLights();
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = sample.FogColor;
            RenderSettings.fogDensity = sample.FogDensity;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = sample.HemiSkyColor;
            RenderSettings.ambientEquatorColor = Color.Lerp(sample.FillColor, sample.HemiSkyColor, 0.22f);
            RenderSettings.ambientGroundColor = sample.HemiGroundColor;
            RenderSettings.ambientIntensity = sample.HemiIntensity;
            RenderSettings.reflectionIntensity = Mathf.Lerp(0.38f, 0.62f, sample.Daylight);
            RenderSettings.sun = Sun;

            CacheCameraState();
            if (_camera != null)
            {
                _camera.clearFlags = CameraClearFlags.SolidColor;
                _camera.backgroundColor = sample.SkyColor;
            }
            ApplyPostProcessing(sample);

            float dayFraction = sample.Hour / 24f;
            float azimuth = dayFraction * Mathf.PI * 2f - Mathf.PI * 0.35f;
            float sunHeight = Mathf.Lerp(10f, 58f, Mathf.Max(0f, sample.SunAltitude));
            Vector3 sunPosition = new Vector3(Mathf.Cos(azimuth) * 46f, sunHeight, Mathf.Sin(azimuth) * 46f);
            Vector3 moonPosition = new Vector3(-Mathf.Cos(azimuth) * 46f,
                                               Mathf.Lerp(24f, 46f, sample.MoonAmount),
                                               -Mathf.Sin(azimuth) * 46f);

            ApplyDirectional(Sun, sample.SunColor, sample.SunIntensity, sunPosition,
                             sample.SunShadows ? LightShadows.Soft : LightShadows.None);
            ApplyDirectional(Moon, sample.MoonColor, sample.MoonIntensity, moonPosition, LightShadows.None);
            ApplyDirectional(ReliefRim, sample.RimColor, sample.RimIntensity,
                             new Vector3(28f, 24f, -36f), LightShadows.None);
            ApplyGroundTint(sample.GroundTintMix);
            ApplyWetReflection(sample);
        }

        private static void ApplyDirectional(Light light, Color color, float intensity,
                                             Vector3 sourcePosition, LightShadows shadows)
        {
            if (light == null) return;
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = shadows;
            light.enabled = intensity > 0.001f;
            if (sourcePosition.sqrMagnitude > 0.001f)
                light.transform.rotation = Quaternion.LookRotation(-sourcePosition.normalized, Vector3.up);
        }

        private void ApplyGroundTint(float mix)
        {
            if (_groundRenderer == null || _groundRenderer.sharedMaterial == null) return;
            Color profileDay = ProfileColor(_effectiveProfile, "groundDay", _groundDayColor);
            float dayMix = ProfileNumber(_effectiveProfile, "groundDayMix", 0f, 0f, 0.65f);
            Color day = Color.Lerp(_groundDayColor, profileDay, dayMix);
            Color night = ProfileColor(_effectiveProfile, "groundNight", 0xb79a70);
            // Шейдер земли (Kromka Ground) мочит себя сам по _Wetness — с учётом рельефа
            // текстуры; прежней земле URP/Lit темнота и блеск задаются здесь.
            Color tint = Color.Lerp(day, night, mix);
            Color color = tint;
            float smoothness = _groundDrySmoothness;
            if (!_groundRenderer.sharedMaterial.HasProperty(WetnessId))
                WetGround(tint, _groundDrySmoothness, _groundWetness, out color, out smoothness);
            WriteGroundTint(color, smoothness);
        }

        /// <summary>
        /// Молния — настоящий свет: бело-голубой удар сверху на всю сцену, а не
        /// только пересвет кадра. Лёгкая экспозиция добавляет ослепление.
        /// </summary>
        private void ApplyLightningFlash()
        {
            if (_lightning != null)
            {
                bool on = _lightningFlash > 0.01f;
                if (_lightning.enabled != on) _lightning.enabled = on;
                if (on)
                {
                    _lightning.intensity = _lightningFlash * 2f;
                    _lightning.color = new Color(0.80f, 0.86f, 1f);
                }
            }
            if (_colorAdjustments == null) return;
            float exposure = Mathf.Log(Mathf.Max(0.01f, _appliedExposure), 2f) + _lightningFlash * 0.4f;
            if (Mathf.Abs(_colorAdjustments.postExposure.value - exposure) > 0.001f)
                _colorAdjustments.postExposure.Override(exposure);
        }

        /// <summary>
        /// Мокрой земле нужно что отражать: гладкая поверхность без окружения лишь
        /// темнеет. Отражение — маленький кубик неба текущего часа и погоды (светлое
        /// пасмурное небо сверху, тёмная земля снизу) в тонкой коробке у пола.
        /// </summary>
        private void ApplyWetReflection(LightingSample sample)
        {
            if (_groundWetness <= 0.001f)
            {
                if (_wetReflection != null) _wetReflection.enabled = false;
                return;
            }
            if (_skyCube == null)
            {
                _skyCube = new Cubemap(SkyCubeSize, TextureFormat.RGBA32, true) { name = "RuntimeWetSky" };
                var probeObject = new GameObject("Wet Ground Reflection");
                probeObject.transform.SetParent(transform, false);
                _wetReflection = probeObject.AddComponent<ReflectionProbe>();
                _wetReflection.mode = ReflectionProbeMode.Custom;
                _wetReflection.customBakedTexture = _skyCube;
                _wetReflection.importance = 10;
                _wetReflection.boxProjection = false;
                _wetReflection.blendDistance = 0f;
                _wetReflection.size = new Vector3(4000f, 3f, 4000f);
                _wetReflection.center = new Vector3(0f, WetReflectionTop - 1.5f, 0f);
            }
            _wetReflection.transform.position = Vector3.zero;
            _wetReflection.enabled = true;
            _wetReflection.intensity = 1f;
            FillSkyCube(_skyCube, sample);
        }

        /// <summary>Кубик неба: горизонт — цвет дымки, зенит — рассеянный свет неба, низ — тёмная земля.</summary>
        public static void FillSkyCube(Cubemap cube, LightingSample sample)
        {
            int size = cube.width;
            Color zenith = sample.HemiSkyColor * Mathf.Lerp(0.35f, 0.95f, sample.Daylight);
            Color horizon = Color.Lerp(sample.FogColor, zenith, 0.35f) * 1.15f;
            Color below = sample.HemiGroundColor * 0.25f;
            var pixels = new Color[size * size];
            for (int face = 0; face < 6; face++)
            {
                for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = (x + 0.5f) / size * 2f - 1f;
                    float v = (y + 0.5f) / size * 2f - 1f;
                    Vector3 direction = CubeDirection((CubemapFace)face, u, v).normalized;
                    float elevation = direction.y;
                    Color color = elevation >= 0f
                        ? Color.Lerp(horizon, zenith, Mathf.Sqrt(elevation))
                        : Color.Lerp(horizon * 0.6f, below, Mathf.Clamp01(-elevation * 4f));
                    color.a = 1f;
                    pixels[y * size + x] = color;
                }
                cube.SetPixels(pixels, (CubemapFace)face);
            }
            cube.Apply(true, false);
        }

        private static Vector3 CubeDirection(CubemapFace face, float u, float v)
        {
            switch (face)
            {
                case CubemapFace.PositiveX: return new Vector3(1f, -v, -u);
                case CubemapFace.NegativeX: return new Vector3(-1f, -v, u);
                case CubemapFace.PositiveY: return new Vector3(u, 1f, v);
                case CubemapFace.NegativeY: return new Vector3(u, -1f, -v);
                case CubemapFace.PositiveZ: return new Vector3(u, -v, 1f);
                default: return new Vector3(-u, -v, -1f);
            }
        }

        /// <summary>
        /// The tint goes into a property block of the ground renderer, never into its
        /// material: that material is often a project asset (the scene builders assign
        /// Kromka_Local_*.mat), and a Play Mode write to it lands in the .mat on disk.
        /// Only the first material is tinted, as the old sharedMaterial write did.
        /// </summary>
        private void WriteGroundTint(Color color, float smoothness)
        {
            Material material = _groundRenderer.sharedMaterial;
            if (_groundTint == null) _groundTint = new MaterialPropertyBlock();
            _groundRenderer.GetPropertyBlock(_groundTint, 0);
            if (material.HasProperty(BaseColorId)) _groundTint.SetColor(BaseColorId, color);
            if (material.HasProperty(ColorId)) _groundTint.SetColor(ColorId, color);
            if (material.HasProperty(SmoothnessId)) _groundTint.SetFloat(SmoothnessId, smoothness);
            if (material.HasProperty(GlossinessId)) _groundTint.SetFloat(GlossinessId, smoothness);
            if (material.HasProperty(WetnessId)) _groundTint.SetFloat(WetnessId, _groundWetness);
            if (material.HasProperty(PuddlesId)) _groundTint.SetFloat(PuddlesId, _groundPuddles);
            if (material.HasProperty(MudId)) _groundTint.SetFloat(MudId, _groundMud);
            if (material.HasProperty(RainId)) _groundTint.SetFloat(RainId, _weatherRain);
            _groundRenderer.SetPropertyBlock(_groundTint, 0);
        }

        private void ApplyPostProcessing(LightingSample sample)
        {
            EnsurePostProcessing();
            if (_postVolume == null) return;
            _postVolume.enabled = _localWorldActive;
            bool mobile = Application.isMobilePlatform;

            _appliedExposure = sample.Exposure;
            _colorAdjustments.postExposure.Override(Mathf.Log(Mathf.Max(0.01f, sample.Exposure), 2f)
                + _lightningFlash * 0.4f);
            _colorAdjustments.contrast.Override(ProfileNumber(_effectiveProfile, "postContrast", 13f, -40f, 40f)
                - 5f * _weatherCloud);
            _colorAdjustments.saturation.Override(ProfileNumber(_effectiveProfile, "postSaturation", -8f, -50f, 30f)
                - 24f * _weatherCloud);
            _colorAdjustments.colorFilter.Override(ProfileColor(_effectiveProfile, "postTint", Color.white));
            _tonemapping.mode.Override(TonemappingMode.ACES);

            _vignette.intensity.Override(ProfileNumber(_effectiveProfile, "vignette", mobile ? 0.10f : 0.17f, 0f, 0.35f));
            _vignette.smoothness.Override(0.55f);
            _vignette.rounded.Override(false);

            _bloom.active = !mobile && QualitySettings.GetQualityLevel() >= 2;
            _bloom.intensity.Override(ProfileNumber(_effectiveProfile, "bloom", 0.18f, 0f, 0.65f));
            _bloom.threshold.Override(1.1f);
            _bloom.scatter.Override(0.52f);
        }

        private void EnsurePostProcessing()
        {
            CacheCameraState();
            if (_camera != null)
            {
                if (_cameraData == null) _cameraData = _camera.GetComponent<UniversalAdditionalCameraData>();
                if (_cameraData == null) _cameraData = _camera.gameObject.AddComponent<UniversalAdditionalCameraData>();
                if (!_cameraPostStateCaptured)
                {
                    _cameraPostStateCaptured = true;
                    _initialRenderPostProcessing = _cameraData.renderPostProcessing;
                }
                _cameraData.renderPostProcessing = true;
            }
            if (_postVolume != null) return;

            var volumeObject = new GameObject("Wasteland Post Processing");
            volumeObject.transform.SetParent(transform, false);
            _postVolume = volumeObject.AddComponent<Volume>();
            _postVolume.isGlobal = true;
            _postVolume.priority = 20f;
            _runtimeVolumeProfile = ScriptableObject.CreateInstance<VolumeProfile>();
            _runtimeVolumeProfile.name = "Runtime Wasteland Profile";
            _postVolume.profile = _runtimeVolumeProfile;
            _colorAdjustments = _runtimeVolumeProfile.Add<ColorAdjustments>(true);
            _vignette = _runtimeVolumeProfile.Add<Vignette>(true);
            _bloom = _runtimeVolumeProfile.Add<Bloom>(true);
            _tonemapping = _runtimeVolumeProfile.Add<Tonemapping>(true);
        }

        private void RestoreGround()
        {
            if (_groundRenderer != null) _groundRenderer.SetPropertyBlock(null, 0);
            _groundRenderer = null;
        }

        private void EnsureLights()
        {
            if (Sun == null)
            {
                Light[] lights = FindObjectsByType<Light>(FindObjectsInactive.Include);
                foreach (Light light in lights)
                {
                    if (light != null && light.type == LightType.Directional && light.name == "Directional Light")
                    {
                        Sun = light;
                        break;
                    }
                }
            }
            if (Sun == null)
            {
                Sun = CreateChildLight("Sun Light");
                _ownsSun = true;
            }
            CaptureSunState();

            if (Moon == null) Moon = FindOrCreateChildLight("Moon Light");
            if (ReliefRim == null) ReliefRim = FindOrCreateChildLight("Relief Rim Light");
            Moon.shadows = LightShadows.None;
            ReliefRim.shadows = LightShadows.None;
            if (_lightning == null)
            {
                _lightning = FindOrCreateChildLight("Lightning Light");
                _lightning.shadows = LightShadows.None;
                _lightning.transform.rotation = Quaternion.Euler(68f, 20f, 0f);
                _lightning.enabled = false;
            }
        }

        private Light FindOrCreateChildLight(string objectName)
        {
            Transform child = transform.Find(objectName);
            Light light = child != null ? child.GetComponent<Light>() : null;
            return light != null ? light : CreateChildLight(objectName);
        }

        private Light CreateChildLight(string objectName)
        {
            var child = new GameObject(objectName);
            child.transform.SetParent(transform, false);
            Light light = child.AddComponent<Light>();
            light.type = LightType.Directional;
            return light;
        }

        private void CaptureSceneState()
        {
            if (_sceneStateCaptured) return;
            _sceneStateCaptured = true;
            _initialFog = RenderSettings.fog;
            _initialFogColor = RenderSettings.fogColor;
            _initialFogMode = RenderSettings.fogMode;
            _initialFogDensity = RenderSettings.fogDensity;
            _initialAmbientMode = RenderSettings.ambientMode;
            _initialAmbientSky = RenderSettings.ambientSkyColor;
            _initialAmbientEquator = RenderSettings.ambientEquatorColor;
            _initialAmbientGround = RenderSettings.ambientGroundColor;
            _initialAmbientIntensity = RenderSettings.ambientIntensity;
            _initialReflectionIntensity = RenderSettings.reflectionIntensity;
            _initialRenderSun = RenderSettings.sun;
            CacheCameraState();
        }

        private void CaptureSunState()
        {
            if (_sunStateCaptured || Sun == null) return;
            _sunStateCaptured = true;
            _initialSunEnabled = Sun.enabled;
            _initialSunColor = Sun.color;
            _initialSunIntensity = Sun.intensity;
            _initialSunShadows = Sun.shadows;
            _initialSunRotation = Sun.transform.rotation;
        }

        private void CacheCameraState()
        {
            if (_camera == null) _camera = Camera.main;
            if (_cameraStateCaptured || _camera == null) return;
            _cameraStateCaptured = true;
            _initialClearFlags = _camera.clearFlags;
            _initialBackground = _camera.backgroundColor;
        }

        private void RestoreSceneState()
        {
            if (!_sceneStateCaptured) return;
            RenderSettings.fog = _initialFog;
            RenderSettings.fogColor = _initialFogColor;
            RenderSettings.fogMode = _initialFogMode;
            RenderSettings.fogDensity = _initialFogDensity;
            RenderSettings.ambientMode = _initialAmbientMode;
            RenderSettings.ambientSkyColor = _initialAmbientSky;
            RenderSettings.ambientEquatorColor = _initialAmbientEquator;
            RenderSettings.ambientGroundColor = _initialAmbientGround;
            RenderSettings.ambientIntensity = _initialAmbientIntensity;
            RenderSettings.reflectionIntensity = _initialReflectionIntensity;
            RenderSettings.sun = _initialRenderSun;

            if (_cameraStateCaptured && _camera != null)
            {
                _camera.clearFlags = _initialClearFlags;
                _camera.backgroundColor = _initialBackground;
            }
            if (_cameraPostStateCaptured && _cameraData != null)
                _cameraData.renderPostProcessing = _initialRenderPostProcessing;
            if (_sunStateCaptured && Sun != null && !_ownsSun)
            {
                Sun.enabled = _initialSunEnabled;
                Sun.color = _initialSunColor;
                Sun.intensity = _initialSunIntensity;
                Sun.shadows = _initialSunShadows;
                Sun.transform.rotation = _initialSunRotation;
            }
        }

        private IEnumerator PollServerClock()
        {
            while (_localWorldActive && FollowServerWorldHour)
            {
                using (UnityWebRequest request = UnityWebRequest.Get(_baseUrl + "/api/wasteland"))
                {
                    yield return request.SendWebRequest();
                    if (request.result == UnityWebRequest.Result.Success)
                    {
                        try
                        {
                            JObject payload = JObject.Parse(request.downloadHandler.text);
                            JToken token = payload["sim"]?["worldHour"];
                            double value = token != null ? token.Value<double>() : double.NaN;
                            if (!double.IsNaN(value) && !double.IsInfinity(value))
                            {
                                _serverHourAtSync = value;
                                _serverSyncRealtime = Time.realtimeSinceStartup;
                                _hasServerClock = true;
                                _lastPollError = string.Empty;
                                ApplyCurrentHour(true);
                            }
                        }
                        catch (JsonException error)
                        {
                            ReportPollError(error.Message);
                        }
                    }
                    else ReportPollError(request.error);
                }
                yield return new WaitForSecondsRealtime(Mathf.Max(2f, ServerPollSeconds));
            }
            _clockPoll = null;
        }

        private void ReportPollError(string error)
        {
            error = string.IsNullOrEmpty(error) ? "unknown error" : error;
            if (error == _lastPollError) return;
            _lastPollError = error;
            Debug.LogWarning("[ROA] World clock: " + error + ". Keeping the fixed web-client hour.");
        }

        private void StopClockPoll()
        {
            if (_clockPoll == null) return;
            StopCoroutine(_clockPoll);
            _clockPoll = null;
        }

        private static float NormalizeHour(float hour)
        {
            hour %= 24f;
            return hour < 0f ? hour + 24f : hour;
        }

        private static float Smooth01(float value)
        {
            value = Mathf.Clamp01(value);
            return value * value * (3f - 2f * value);
        }

        private static float ProfileNumber(JObject profile, string key, float fallback, float min, float max)
        {
            JToken token = profile?[key];
            if (token == null || token.Type == JTokenType.Null) return fallback;
            float value;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
            {
                try
                {
                    value = token.Value<float>();
                    return Mathf.Clamp(value, min, max);
                }
                catch (System.Exception)
                {
                    return fallback;
                }
            }

            string raw = token.ToString();
            if (float.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                || float.TryParse(raw, NumberStyles.Float, CultureInfo.CurrentCulture, out value))
                return Mathf.Clamp(value, min, max);
            return fallback;
        }

        /// <summary>
        /// Базовый профиль по типу локации и поверх него авторский visualProfile.
        /// Открыт для редакторской пробы: она проверяет им реальные локации.
        /// </summary>
        public static JObject ResolveVisualProfile(LocationDefinition location)
        {
            string kind = (location?.Kind ?? string.Empty).Trim().ToLowerInvariant();
            bool inhabited = kind == "settlement" || kind == "production";
            JObject profile;
            if (kind == "resource")
            {
                profile = new JObject
                {
                    ["id"] = "resource_dust",
                    ["skyDay"] = "#4f5960",
                    ["fogDay"] = "#62584d",
                    ["fogDensityDay"] = 0.00265f,
                    ["exposureDay"] = 1.02f,
                    ["sunDay"] = "#f3d2a0",
                    ["hemiSkyDay"] = "#c9c7bd",
                    ["groundDay"] = "#927b68",
                    ["groundDayMix"] = 0.22f,
                    ["groundNight"] = "#78695a",
                    ["postTint"] = "#eef1ef",
                    ["postContrast"] = 13f,
                    ["postSaturation"] = -12f,
                    ["vignette"] = 0.17f,
                    ["bloom"] = 0.10f
                };
            }
            else if (!inhabited && (kind == "lair" || location?.EncounterOnly == true || location?.Safe == false))
            {
                profile = new JObject
                {
                    ["id"] = "hostile_cold",
                    ["skyDay"] = "#344a58",
                    ["fogDay"] = "#465058",
                    ["fogDawn"] = "#67433e",
                    ["fogDensityDay"] = 0.00285f,
                    ["exposureDay"] = 0.99f,
                    ["sunDay"] = "#cedee5",
                    ["sunDawn"] = "#d9a58c",
                    ["hemiSkyDay"] = "#aebfc5",
                    ["hemiGroundDay"] = "#535f65",
                    ["fillDay"] = "#b8c6c9",
                    ["groundDay"] = "#738087",
                    ["groundDayMix"] = 0.36f,
                    ["groundNight"] = "#626d72",
                    ["postTint"] = "#e9f2f5",
                    ["postContrast"] = 16f,
                    ["postSaturation"] = -16f,
                    ["vignette"] = 0.20f,
                    ["bloom"] = 0.12f
                };
            }
            else
            {
                // Посёлки и производства, а с ними всё остальное безопасное: учебный двор
                // каравана, рынок территории, личная база. Отдельного «нейтрального»
                // профиля больше нет: он был синим (земля на 65 % #0033ff, голубое
                // солнце) под открытую пустошь, а пустошь теперь вся опасная и берёт
                // hostile_cold — синева доставалась только обжитым местам.
                profile = new JObject
                {
                    ["id"] = "settlement_warm",
                    ["skyDay"] = "#5b5146",
                    ["fogDay"] = "#625548",
                    ["fogDensityDay"] = 0.0020f,
                    ["exposureDay"] = 1.04f,
                    ["sunDawn"] = "#ff9b58",
                    ["fillDay"] = "#e7d0b0",
                    ["groundDay"] = "#b29370",
                    ["groundDayMix"] = 0.10f,
                    ["groundNight"] = "#8e735a",
                    ["postTint"] = "#f4f1ea",
                    ["postContrast"] = 13f,
                    ["postSaturation"] = -2f,
                    ["vignette"] = 0.14f,
                    ["bloom"] = 0.16f
                };
            }

            if (location?.VisualProfile != null)
            {
                profile.Merge(location.VisualProfile.DeepClone(), new JsonMergeSettings
                {
                    MergeArrayHandling = MergeArrayHandling.Replace,
                    MergeNullValueHandling = MergeNullValueHandling.Ignore
                });
            }
            return profile;
        }

        private static Color ProfileColor(JObject profile, string key, int fallback)
        {
            return ProfileColor(profile, key, HexColor(fallback));
        }

        private static Color ProfileColor(JObject profile, string key, Color fallback)
        {
            string raw = profile?[key]?.ToString();
            Color color;
            if (!string.IsNullOrWhiteSpace(raw)
                && ColorUtility.TryParseHtmlString(raw.StartsWith("#") ? raw : "#" + raw, out color))
                return color;
            return fallback;
        }

        private static Color HexColor(int rgb)
        {
            return new Color(((rgb >> 16) & 0xff) / 255f,
                             ((rgb >> 8) & 0xff) / 255f,
                             (rgb & 0xff) / 255f);
        }

        private static Color ReadMaterialColor(Material material)
        {
            return material != null && material.HasProperty("_BaseColor")
                ? material.GetColor("_BaseColor")
                : (material != null ? material.color : Color.white);
        }

        private static void DestroyRuntime(Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }
    }
}
