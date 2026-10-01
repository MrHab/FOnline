using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Погода поверх освещения часа. Буря выброса (RoaRadiationStorm) каждый кадр
    /// сообщает, насколько она здесь (0..1) и вспышку молнии: свет тускнеет и
    /// зеленеет, туман густеет, небо темнеет, отдельный объём постобработки
    /// (приоритет выше обычного) даёт зелёный фильтр и виньетку. Основа — всегда
    /// CurrentSample: погода не копится поверх себя и уходит без следа.
    /// </summary>
    public sealed partial class RoaWorldLighting
    {
        private static readonly Color StormFog = new Color(0.25f, 0.28f, 0.19f, 1f);
        private static readonly Color StormSky = new Color(0.13f, 0.16f, 0.1f, 1f);
        private static readonly Color StormSun = new Color(0.72f, 0.9f, 0.6f, 1f);
        private static readonly Color StormFilter = new Color(0.8f, 0.95f, 0.66f, 1f);
        private static readonly Color FlashColor = new Color(0.86f, 1f, 0.88f, 1f);

        private float _weatherStorm;
        private float _weatherFlash;
        private bool _weatherApplied;
        private Volume _stormVolume;
        private VolumeProfile _stormProfile;
        private ColorAdjustments _stormColor;
        private Vignette _stormVignette;

        /// <summary>Сила бури, которую сейчас показывает свет (0..1).</summary>
        public float WeatherStorm { get { return _weatherStorm; } }

        /// <summary>Погода: буря 0..1 и вспышка молнии 0..1. Ноль и ноль — обычный свет часа.</summary>
        public void SetWeather(float storm, float flash)
        {
            _weatherStorm = Mathf.Clamp01(storm);
            _weatherFlash = Mathf.Clamp01(flash);
        }

        private void LateUpdate()
        {
            RefreshWeather();
        }

        /// <summary>Наложить погоду на свет часа сейчас (каждый кадр; пробы зовут сами).</summary>
        public void RefreshWeather()
        {
            bool active = _localWorldActive && (_weatherStorm > 0.001f || _weatherFlash > 0.001f);
            if (active) ApplyWeather();
            else if (_weatherApplied) ClearWeather();
        }

        private void ApplyWeather()
        {
            LightingSample sample = CurrentSample;
            float storm = _weatherStorm;
            float flash = _weatherFlash;
            bool mobile = Application.isMobilePlatform;
            RenderSettings.fogColor = Color.Lerp(Color.Lerp(sample.FogColor, StormFog, storm * 0.9f), FlashColor, flash * 0.25f);
            RenderSettings.fogDensity = sample.FogDensity + storm * (mobile ? 0.014f : 0.02f);
            RenderSettings.ambientIntensity = sample.HemiIntensity * (1f - 0.32f * storm) + flash * 0.45f;
            if (_camera != null)
                _camera.backgroundColor = Color.Lerp(Color.Lerp(sample.SkyColor, StormSky, storm), FlashColor, flash * 0.35f);
            if (Sun != null)
            {
                Sun.intensity = sample.SunIntensity * (1f - 0.62f * storm) + flash * 1.1f;
                Sun.color = Color.Lerp(Color.Lerp(sample.SunColor, StormSun, storm * 0.65f), FlashColor, flash);
                Sun.enabled = Sun.intensity > 0.001f;
            }
            EnsureStormVolume();
            _stormVolume.enabled = true;
            _stormVolume.weight = Mathf.Clamp01(Mathf.Max(storm, flash * 0.5f));
            _stormColor.postExposure.Override(Mathf.Lerp(-0.45f, 0.55f, flash));
            _stormColor.contrast.Override(14f);
            _stormColor.saturation.Override(Mathf.Lerp(-24f, -10f, flash));
            _stormColor.colorFilter.Override(Color.Lerp(StormFilter, new Color(0.92f, 1f, 0.92f, 1f), flash));
            _stormVignette.intensity.Override(0.38f * (1f - flash));
            _stormVignette.color.Override(new Color(0.04f, 0.07f, 0.03f, 1f));
            _stormVignette.smoothness.Override(0.6f);
            _weatherApplied = true;
        }

        private void ClearWeather()
        {
            _weatherApplied = false;
            if (_stormVolume != null)
            {
                _stormVolume.weight = 0f;
                _stormVolume.enabled = false;
            }
            // Вне локального мира свет сцены уже вернули (SetLocalWorldActive), его не трогаем.
            if (!_localWorldActive) return;
            LightingSample sample = CurrentSample;
            RenderSettings.fogColor = sample.FogColor;
            RenderSettings.fogDensity = sample.FogDensity;
            RenderSettings.ambientIntensity = sample.HemiIntensity;
            if (_camera != null) _camera.backgroundColor = sample.SkyColor;
            if (Sun != null)
            {
                Sun.intensity = sample.SunIntensity;
                Sun.color = sample.SunColor;
                Sun.enabled = sample.SunIntensity > 0.001f;
            }
        }

        private void EnsureStormVolume()
        {
            if (_stormVolume != null) return;
            var volumeObject = new GameObject("Storm Post Processing");
            volumeObject.transform.SetParent(transform, false);
            _stormVolume = volumeObject.AddComponent<Volume>();
            _stormVolume.isGlobal = true;
            _stormVolume.priority = 25f;
            _stormVolume.weight = 0f;
            _stormProfile = ScriptableObject.CreateInstance<VolumeProfile>();
            _stormProfile.name = "Runtime Storm Profile";
            _stormVolume.profile = _stormProfile;
            _stormColor = _stormProfile.Add<ColorAdjustments>(true);
            _stormVignette = _stormProfile.Add<Vignette>(true);
        }
    }
}
