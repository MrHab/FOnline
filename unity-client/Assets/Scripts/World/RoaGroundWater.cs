using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Где под ногой вода: лужи после дождя и вода с карты сервера. Лужи считаются той же
    /// формулой, что в шейдере земли Kromka Ground (шум по мировым XZ, низины, тропы), но
    /// без высоты текстуры набора — её CPU не знает, и край лужи здесь размыт на пару
    /// сантиметров уровня. Хватает, чтобы шаг и колесо в луже плеснули, а на сухом — нет.
    /// Землю и уровень луж ставят загрузчик локации и погода (RoaGameBootstrap, RoaWeather).
    /// </summary>
    public static class RoaGroundWater
    {
        /// <summary>
        /// Вода глубже этого — всплеск (единицы уровня шейдера, не метры). С запасом: рельеф
        /// текстуры сдвигает дно лужи в шейдере до ±0,125, и у самого края CPU не уверен.
        /// </summary>
        public const float SplashDepth = 0.06f;
        /// <summary>Средняя высота текстуры набора (маска R), которую шейдер добавляет к дну лужи.</summary>
        private const float MeanTextureHeight = 0.5f;

        public static RoaLocalTerrain Terrain { get; set; }
        /// <summary>Уровень луж по погоде (RoaWeather.Puddles), 0..1.</summary>
        public static float Puddles { get; set; }

        /// <summary>Глубина лужи над её дном в точке: больше нуля — вода, меньше — сухо.</summary>
        public static float PuddleDepth(Vector3 world)
        {
            if (Puddles <= 0.01f) return -1f;
            float path = Terrain != null ? Terrain.SurfaceAt(world).r : 0f;
            return PuddleDepth(world.x, world.z, Puddles, path);
        }

        /// <summary>Формула луж шейдера Kromka Ground при средней высоте текстуры.</summary>
        public static float PuddleDepth(float x, float z, float puddles, float path)
        {
            float basin = Basin(x, z);
            float field = ValueNoise(x * 0.45f + 9.1f, z * 0.45f + 9.1f) * 0.55f
                + ValueNoise(x * 1.1f - 2.3f, z * 1.1f - 2.3f) * 0.2f + basin * 0.25f;
            float floorHeight = field * 0.75f + MeanTextureHeight * 0.25f - path * 0.15f;
            return puddles * 0.4f - floorHeight;
        }

        /// <summary>Под ногой вода: лужа глубже порога или вода с карты сервера.</summary>
        public static bool InWater(Vector3 world)
        {
            if (Terrain != null && Terrain.SurfaceAt(world).b > 0.5f) return true;
            return PuddleDepth(world) > SplashDepth;
        }

        public static float Basin(float x, float z)
        {
            return ValueNoise(x * 0.085f + 3.7f, z * 0.085f + 3.7f) * 0.65f
                + ValueNoise(x * 0.21f - 5.1f, z * 0.21f - 5.1f) * 0.35f;
        }

        /// <summary>Hash21 шейдера: frac(p·(123.34, 456.21)); p += dot(p, p + 45.32); frac(p.x·p.y).</summary>
        public static float Hash21(float x, float y)
        {
            x = Frac(x * 123.34f);
            y = Frac(y * 456.21f);
            float dot = x * (x + 45.32f) + y * (y + 45.32f);
            x += dot;
            y += dot;
            return Frac(x * y);
        }

        public static float ValueNoise(float x, float y)
        {
            float cellX = Mathf.Floor(x);
            float cellY = Mathf.Floor(y);
            float fx = x - cellX;
            float fy = y - cellY;
            fx = fx * fx * (3f - 2f * fx);
            fy = fy * fy * (3f - 2f * fy);
            float a = Hash21(cellX, cellY);
            float b = Hash21(cellX + 1f, cellY);
            float c = Hash21(cellX, cellY + 1f);
            float d = Hash21(cellX + 1f, cellY + 1f);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        private static float Frac(float value)
        {
            return value - Mathf.Floor(value);
        }
    }
}
