using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Атмосфера стратегической карты: пост-обработка (ACES, bloom, виньетка,
    /// цветокоррекция), время суток от авторитетного worldHour симуляции,
    /// ползущие тени облаков (light cookie) и низкие клубы токсичной дымки по
    /// краю диорамы. Живёт только пока открыта глобальная карта: создаётся из
    /// ConfigureMapLighting и полностью восстанавливает камеру и солнце при
    /// закрытии. Все эффекты — презентация; игровые правила не трогаются.
    /// </summary>
    public sealed class RoaGlobalMapAtmosphere : MonoBehaviour
    {
        private const float VisualLerpPerSecond = 0.6f;
        private const float CloudDriftPointsPerSecond = 1.6f;
        private const int CloudCookieSize = 256;
        private const int EdgeBillowCount = 14;

        /// <summary>Клубы дымки по краю можно отключить в инспекторе.</summary>
        public bool EdgeBillowsEnabled = true;

        private RoaGlobalMap _map;
        private Light _sun;
        private RoaCameraRig _rig;

        private Quaternion _savedSunRotation;
        private Color _savedSunColor;
        private float _savedSunIntensity;
        private Texture _savedSunCookie;
        private bool _sunSaved;

        private Camera _camera;
        private bool _cameraFlagSaved;
        private bool _savedPostProcessing;

        private GameObject _volumeObject;
        private VolumeProfile _profile;
        private ColorAdjustments _colorAdjustments;
        private Vignette _vignette;

        private Texture2D _cloudCookie;
        private Vector2 _cloudOffset;

        private readonly List<Transform> _billows = new List<Transform>();
        private Texture2D _billowTexture;
        private Material _billowMaterial;

        private float _visualHour = 12f;

        public static RoaGlobalMapAtmosphere Attach(RoaGlobalMap map, Light sun, RoaCameraRig rig)
        {
            var go = new GameObject("GlobalMapAtmosphere");
            var atmosphere = go.AddComponent<RoaGlobalMapAtmosphere>();
            atmosphere._map = map;
            atmosphere._rig = rig;
            atmosphere.CaptureSun(sun);
            atmosphere._visualHour = map != null ? map.WorldHour : 12f;
            atmosphere.BuildVolume();
            atmosphere.BuildCloudCookie();
            atmosphere.BuildEdgeBillows();
            return atmosphere;
        }

        private void CaptureSun(Light sun)
        {
            _sun = sun;
            if (_sun == null) return;
            _sunSaved = true;
            _savedSunRotation = _sun.transform.rotation;
            _savedSunColor = _sun.color;
            _savedSunIntensity = _sun.intensity;
            _savedSunCookie = _sun.cookie;
        }

        // ------------------------------------------------------------------
        // Чистые формулы времени суток: их проверяет редакторская проба.

        /// <summary>0 — глухая ночь, 1 — полдень. Плавный купол между 5:30 и 18:30.</summary>
        public static float DaylightFactor(float hour)
        {
            float t = Mathf.Repeat(hour, 24f);
            if (t <= 5.5f || t >= 18.5f) return 0f;
            return Mathf.Clamp01(Mathf.Sin(Mathf.PI * (t - 5.5f) / 13f));
        }

        /// <summary>Тёплый фактор рассвета/заката: пик у горизонта, ноль днём и ночью.</summary>
        public static float DuskFactor(float hour)
        {
            float daylight = DaylightFactor(hour);
            return Mathf.Clamp01(1f - Mathf.Abs(daylight - 0.3f) / 0.3f) * (daylight > 0.011f ? 1f : 0f);
        }

        /// <summary>Высота солнца: у горизонта на рассвете, 58° в полдень; ночью — «луна».</summary>
        public static float SunPitchDeg(float hour)
        {
            float daylight = DaylightFactor(hour);
            return daylight <= 0f ? 42f : Mathf.Lerp(14f, 58f, daylight);
        }

        public static Color SunColor(float hour)
        {
            float daylight = DaylightFactor(hour);
            float dusk = DuskFactor(hour);
            if (daylight <= 0f) return new Color(0.62f, 0.72f, 0.95f); // луна
            var noon = new Color(1f, 0.956f, 0.87f);
            var horizon = new Color(1f, 0.62f, 0.32f);
            return Color.Lerp(noon, horizon, dusk);
        }

        public static float SunIntensity(float hour)
        {
            float daylight = DaylightFactor(hour);
            return daylight <= 0f ? 0.24f : Mathf.Lerp(0.42f, 1.08f, daylight);
        }

        /// <summary>Цветофильтр пост-обработки: тёплый закат, холодная ночь.</summary>
        public static Color GradeFilter(float hour)
        {
            float daylight = DaylightFactor(hour);
            float dusk = DuskFactor(hour);
            var day = Color.white;
            var night = new Color(0.78f, 0.84f, 1.02f);
            var sunset = new Color(1.04f, 0.94f, 0.85f);
            Color baseGrade = Color.Lerp(night, day, Mathf.Clamp01(daylight * 1.6f));
            return Color.Lerp(baseGrade, sunset, dusk * 0.8f);
        }

        // ------------------------------------------------------------------

        private void BuildVolume()
        {
            _profile = ScriptableObject.CreateInstance<VolumeProfile>();

            var tonemapping = _profile.Add<Tonemapping>(true);
            tonemapping.mode.value = TonemappingMode.ACES;

            var bloom = _profile.Add<Bloom>(true);
            bloom.threshold.value = 1.05f;
            bloom.intensity.value = 0.55f;
            bloom.scatter.value = 0.62f;

            _vignette = _profile.Add<Vignette>(true);
            _vignette.intensity.value = 0.24f;
            _vignette.smoothness.value = 0.42f;
            _vignette.color.value = new Color(0.02f, 0.03f, 0.02f);

            _colorAdjustments = _profile.Add<ColorAdjustments>(true);
            _colorAdjustments.saturation.value = 6f;
            _colorAdjustments.contrast.value = 7f;
            _colorAdjustments.colorFilter.value = GradeFilter(_visualHour);

            _volumeObject = new GameObject("GlobalMapVolume");
            _volumeObject.transform.SetParent(transform, false);
            var volume = _volumeObject.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 32f;
            volume.profile = _profile;
        }

        private void EnsureCameraPostProcessing()
        {
            Camera view = _rig != null ? _rig.GetComponent<Camera>() : Camera.main;
            if (view == null || view == _camera) return;
            RestoreCameraPostProcessing();
            _camera = view;
            UniversalAdditionalCameraData data = view.GetUniversalAdditionalCameraData();
            if (data == null) return;
            _cameraFlagSaved = true;
            _savedPostProcessing = data.renderPostProcessing;
            data.renderPostProcessing = true;
        }

        private void RestoreCameraPostProcessing()
        {
            if (!_cameraFlagSaved || _camera == null) return;
            UniversalAdditionalCameraData data = _camera.GetUniversalAdditionalCameraData();
            if (data != null) data.renderPostProcessing = _savedPostProcessing;
            _cameraFlagSaved = false;
            _camera = null;
        }

        // ------------------------------------------------------------------

        /// <summary>
        /// Бесшовный шум для cookie солнца: четырёхугловое смешивание перлина,
        /// значения около единицы — тени облаков лишь слегка приглушают свет.
        /// </summary>
        private void BuildCloudCookie()
        {
            if (_sun == null) return;
            _cloudCookie = new Texture2D(CloudCookieSize, CloudCookieSize, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Bilinear,
                name = "GlobalMapCloudCookie"
            };
            const float scale = 5.2f;
            var pixels = new Color[CloudCookieSize * CloudCookieSize];
            for (int y = 0; y < CloudCookieSize; y++)
            {
                for (int x = 0; x < CloudCookieSize; x++)
                {
                    float u = (float)x / CloudCookieSize;
                    float v = (float)y / CloudCookieSize;
                    float noise = SeamlessPerlin(u, v, scale);
                    // Облачные пятна: затемняют максимум на 20%, большая часть неба чистая.
                    float shade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((noise - 0.56f) / 0.3f)) * 0.2f;
                    pixels[y * CloudCookieSize + x] = new Color(shade, shade, shade, 1f);
                }
            }
            _cloudCookie.SetPixels(pixels);
            _cloudCookie.Apply(false, false);

            _sun.cookie = _cloudCookie;
            UniversalAdditionalLightData lightData = _sun.GetUniversalAdditionalLightData();
            if (lightData != null)
            {
                float span = _map != null ? _map.MapWorldSpan : 120f;
                lightData.lightCookieSize = Vector2.one * Mathf.Max(60f, span * 1.15f);
                lightData.lightCookieOffset = Vector2.zero;
            }
        }

        private static float SeamlessPerlin(float u, float v, float scale)
        {
            float x = u * scale, y = v * scale;
            float a = Mathf.PerlinNoise(x, y);
            float b = Mathf.PerlinNoise(x - scale, y);
            float c = Mathf.PerlinNoise(x, y - scale);
            float d = Mathf.PerlinNoise(x - scale, y - scale);
            return Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(c, d, u), v);
        }

        // ------------------------------------------------------------------

        /// <summary>
        /// Низкие клубы дымки по периметру диорамы: широкие вертикальные квады
        /// с мягким процедурным спрайтом, медленным дрейфом и пульсом альфы.
        /// Референс — docs/art/references/global-map-toxic-fog-low-billows.
        /// </summary>
        private void BuildEdgeBillows()
        {
            if (!EdgeBillowsEnabled || _map == null) return;
            _billowTexture = BuildBillowTexture();
            Shader shader = Shader.Find("Sprites/Default")
                ?? Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) return;
            _billowMaterial = new Material(shader)
            {
                mainTexture = _billowTexture,
                renderQueue = 2950
            };

            float radius = _map.MapWorldSpan * 0.62f;
            for (int i = 0; i < EdgeBillowCount; i++)
            {
                float angle = i * Mathf.PI * 2f / EdgeBillowCount;
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
                quad.name = "EdgeBillow:" + i;
                Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(_map.MapRoot != null ? _map.MapRoot.transform : transform, false);
                quad.transform.localPosition = new Vector3(
                    Mathf.Cos(angle) * radius, 2.4f, Mathf.Sin(angle) * radius);
                float width = radius * 0.85f;
                quad.transform.localScale = new Vector3(width, width * 0.22f, 1f);
                var renderer = quad.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = _billowMaterial;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                _billows.Add(quad.transform);
            }
        }

        private static Texture2D BuildBillowTexture()
        {
            const int size = 128;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                name = "GlobalMapEdgeBillow"
            };
            var tint = new Color(0.30f, 0.42f, 0.22f);
            var pixels = new Color[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float u = (float)x / size, v = (float)y / size;
                    // Мягкий клуб: горизонтальный купол, тяжёлый низ, рваный верх.
                    float dome = Mathf.Clamp01(1f - Mathf.Abs(u - 0.5f) * 2f);
                    float rise = Mathf.Clamp01(1f - v * 1.25f);
                    float noise = Mathf.PerlinNoise(u * 6.5f, v * 3.4f);
                    float alpha = Mathf.Clamp01(dome * rise * (0.35f + noise * 0.65f)) * 0.34f;
                    pixels[y * size + x] = new Color(tint.r, tint.g, tint.b, alpha);
                }
            }
            texture.SetPixels(pixels);
            texture.Apply(false, false);
            return texture;
        }

        // ------------------------------------------------------------------

        private void LateUpdate()
        {
            EnsureCameraPostProcessing();

            float target = _map != null ? _map.WorldHour : _visualHour;
            // Часы идут по кругу: 23 → 1 лерпится через полночь, а не назад.
            float delta = Mathf.DeltaAngle(_visualHour * 15f, target * 15f) / 15f;
            _visualHour = Mathf.Repeat(
                _visualHour + delta * Mathf.Clamp01(Time.unscaledDeltaTime * VisualLerpPerSecond), 24f);

            ApplySun();
            DriftClouds();
            AnimateBillows();
        }

        private void ApplySun()
        {
            if (_sun == null) return;
            float yaw = _savedSunRotation.eulerAngles.y;
            _sun.transform.rotation = Quaternion.Euler(SunPitchDeg(_visualHour), yaw, 0f);
            _sun.color = SunColor(_visualHour);
            _sun.intensity = SunIntensity(_visualHour);
            if (_colorAdjustments != null)
                _colorAdjustments.colorFilter.value = GradeFilter(_visualHour);
            if (_vignette != null)
                _vignette.intensity.value = Mathf.Lerp(0.3f, 0.24f, DaylightFactor(_visualHour));
        }

        private void DriftClouds()
        {
            if (_sun == null || _cloudCookie == null) return;
            UniversalAdditionalLightData lightData = _sun.GetUniversalAdditionalLightData();
            if (lightData == null) return;
            _cloudOffset += new Vector2(1f, 0.36f)
                * (CloudDriftPointsPerSecond * Time.unscaledDeltaTime);
            lightData.lightCookieOffset = _cloudOffset;
        }

        private void AnimateBillows()
        {
            if (_billows.Count == 0) return;
            Camera view = _camera != null ? _camera : Camera.main;
            float time = Time.unscaledTime;
            for (int i = 0; i < _billows.Count; i++)
            {
                Transform billow = _billows[i];
                if (billow == null) continue;
                if (view != null)
                {
                    Vector3 toCamera = view.transform.position - billow.position;
                    toCamera.y = 0f;
                    if (toCamera.sqrMagnitude > 0.01f)
                        billow.rotation = Quaternion.LookRotation(-toCamera);
                }
                float phase = i * 1.7f;
                billow.localPosition += new Vector3(
                    Mathf.Sin(time * 0.05f + phase), 0f, Mathf.Cos(time * 0.043f + phase))
                    * (Time.unscaledDeltaTime * 0.35f);
            }
        }

        // ------------------------------------------------------------------

        /// <summary>Полное восстановление: камера, солнце, cookie, объекты и текстуры.</summary>
        public void DisposeAtmosphere()
        {
            RestoreCameraPostProcessing();
            if (_sun != null && _sunSaved)
            {
                _sun.transform.rotation = _savedSunRotation;
                _sun.color = _savedSunColor;
                _sun.intensity = _savedSunIntensity;
                _sun.cookie = _savedSunCookie;
                UniversalAdditionalLightData lightData = _sun.GetUniversalAdditionalLightData();
                if (lightData != null) lightData.lightCookieOffset = Vector2.zero;
            }
            for (int i = 0; i < _billows.Count; i++)
                if (_billows[i] != null) Destroy(_billows[i].gameObject);
            _billows.Clear();
            if (_billowMaterial != null) Destroy(_billowMaterial);
            if (_billowTexture != null) Destroy(_billowTexture);
            if (_cloudCookie != null) Destroy(_cloudCookie);
            if (_profile != null) Destroy(_profile);
            Destroy(gameObject);
        }
    }
}
