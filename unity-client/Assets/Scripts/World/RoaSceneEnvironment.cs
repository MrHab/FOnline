using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Снимок освещения сцены: ambient, туман, небо и солнце.
    ///
    /// Нужен потому, что <see cref="RenderSettings"/> работает не с конкретной
    /// сценой, а с текущей активной. Локации грузятся аддитивно, активной не
    /// становятся, и всё их авторское окружение до сих пор молча выбрасывалось.
    /// Снимок позволяет снять настройки с авторской сцены коротким переключением
    /// активной и применить их к той сцене, которая рисует мир на самом деле.
    /// </summary>
    public struct RoaSceneEnvironment
    {
        public AmbientMode AmbientMode;
        public Color AmbientSky;
        public Color AmbientEquator;
        public Color AmbientGround;
        public Color AmbientLight;
        public float AmbientIntensity;

        public bool FogEnabled;
        public Color FogColor;
        public FogMode FogMode;
        public float FogDensity;
        public float FogStartDistance;
        public float FogEndDistance;

        public Material Skybox;
        public Light Sun;
        public float ReflectionIntensity;
        public SphericalHarmonicsL2 AmbientProbe;

        public static RoaSceneEnvironment Capture()
        {
            return new RoaSceneEnvironment
            {
                AmbientMode = RenderSettings.ambientMode,
                AmbientSky = RenderSettings.ambientSkyColor,
                AmbientEquator = RenderSettings.ambientEquatorColor,
                AmbientGround = RenderSettings.ambientGroundColor,
                AmbientLight = RenderSettings.ambientLight,
                AmbientIntensity = RenderSettings.ambientIntensity,

                FogEnabled = RenderSettings.fog,
                FogColor = RenderSettings.fogColor,
                FogMode = RenderSettings.fogMode,
                FogDensity = RenderSettings.fogDensity,
                FogStartDistance = RenderSettings.fogStartDistance,
                FogEndDistance = RenderSettings.fogEndDistance,

                Skybox = RenderSettings.skybox,
                Sun = RenderSettings.sun,
                ReflectionIntensity = RenderSettings.reflectionIntensity,
                AmbientProbe = RenderSettings.ambientProbe
            };
        }

        public void Apply()
        {
            // Порядок важен: ambientMode решает, какие из цветов Unity вообще
            // читает, поэтому он выставляется первым.
            RenderSettings.ambientMode = AmbientMode;
            RenderSettings.ambientSkyColor = AmbientSky;
            RenderSettings.ambientEquatorColor = AmbientEquator;
            RenderSettings.ambientGroundColor = AmbientGround;
            RenderSettings.ambientLight = AmbientLight;
            RenderSettings.ambientIntensity = AmbientIntensity;

            RenderSettings.fog = FogEnabled;
            RenderSettings.fogColor = FogColor;
            RenderSettings.fogMode = FogMode;
            RenderSettings.fogDensity = FogDensity;
            RenderSettings.fogStartDistance = FogStartDistance;
            RenderSettings.fogEndDistance = FogEndDistance;

            RenderSettings.skybox = Skybox;
            if (Sun != null) RenderSettings.sun = Sun;
            RenderSettings.reflectionIntensity = ReflectionIntensity;
            RenderSettings.ambientProbe = AmbientProbe;
        }
    }
}
