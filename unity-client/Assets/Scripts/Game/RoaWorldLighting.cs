using System.Collections;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Local-world lighting ported from 02b_lighting_time.js. The shipped web client
    /// deliberately keeps the clock at 16:12, so Unity does the same by default.
    /// Server time can be enabled for diagnostics or a future live cycle without
    /// changing the authoritative Node simulation.
    /// </summary>
    public sealed class RoaWorldLighting : MonoBehaviour
    {
        public const float WebFixedWorldHour = 16.2f;
        private const float GameDayRealSeconds = 60f * 60f;

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
        private Renderer _groundRenderer;
        private Color _groundDayColor = Color.white;
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
            if (_ownsSun && Sun != null) DestroyRuntime(Sun.gameObject);
        }

        private void Update()
        {
            if (!_localWorldActive) return;

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
            _groundRenderer = groundRenderer;
            if (_groundRenderer != null && _groundRenderer.sharedMaterial != null)
                _groundDayColor = ReadMaterialColor(_groundRenderer.sharedMaterial);

            VisualProfileId = location != null
                ? (location.VisualProfile?["id"]?.ToString() ?? "default")
                : "default";
            ApplyCurrentHour(true);
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
            if (Sun != null) Sun.enabled = false;
            if (Moon != null) Moon.enabled = false;
            if (ReliefRim != null) ReliefRim.enabled = false;
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
                                   ProfileColor(profile, "skyDay", 0x3b2a1a), daylight);
            sky = Color.Lerp(sky, ProfileColor(profile, "skyDawn", 0x775033), twilight * 0.28f);

            Color fog = Color.Lerp(ProfileColor(profile, "fogNight", 0x394058),
                                   ProfileColor(profile, "fogDay", 0x46311e), daylight);
            fog = Color.Lerp(fog, ProfileColor(profile, "fogDawn", 0x765031), twilight * 0.24f);

            Color hemiSky = Color.Lerp(ProfileColor(profile, "hemiSkyNight", 0xc9d7ff),
                                       ProfileColor(profile, "hemiSkyDay", 0xe2c9a4), daylight);
            hemiSky = Color.Lerp(hemiSky, ProfileColor(profile, "hemiSkyDawn", 0xe2a66f), twilight * 0.35f);
            Color hemiGround = Color.Lerp(ProfileColor(profile, "hemiGroundNight", 0x84745e),
                                          ProfileColor(profile, "hemiGroundDay", 0x85643e), daylight);

            Color fill = Color.Lerp(ProfileColor(profile, "fillNight", 0xc2d0ff),
                                    ProfileColor(profile, "fillDay", 0xecd4ad), daylight);
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
            float fogDay = ProfileNumber(profile, "fogDensityDay", 0.0026f, 0f, 0.02f);
            float exposureNight = ProfileNumber(profile, "exposureNight", mobile ? 1.28f : 1.18f, 0.5f, 2f);
            float exposureDay = ProfileNumber(profile, "exposureDay", mobile ? 1.10f : 1.16f, 0.5f, 2f);
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
            Apply(Evaluate(hour, _location != null ? _location.VisualProfile : null, Application.isMobilePlatform));
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
            Color night = ProfileColor(_location != null ? _location.VisualProfile : null, "groundNight", 0xb79a70);
            WriteMaterialColor(_groundRenderer.sharedMaterial, Color.Lerp(_groundDayColor, night, mix));
        }

        private void RestoreGround()
        {
            if (_groundRenderer != null && _groundRenderer.sharedMaterial != null)
                WriteMaterialColor(_groundRenderer.sharedMaterial, _groundDayColor);
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

        private static void WriteMaterialColor(Material material, Color color)
        {
            if (material == null) return;
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        }

        private static void DestroyRuntime(Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }
    }
}
