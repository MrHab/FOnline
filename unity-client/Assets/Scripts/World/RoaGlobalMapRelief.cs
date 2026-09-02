using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Запечённое поле высот глобальной карты. Генерируется редакторским
    /// инструментом «Сгенерировать рельеф глобальной карты» из авторских
    /// данных data/global-map.json и хранится как ассет в Resources.
    ///
    /// Рантайм читает поле только для посадки: PointToWorld карты добавляет
    /// высоту рельефа, поэтому маркеры, кольца, отряды и подписи едут по
    /// холмам, а не парят над плоскостью. Отсутствующий ассет — честный ноль:
    /// карта остаётся плоской, как до генерации.
    /// </summary>
    public sealed class RoaGlobalMapRelief : ScriptableObject
    {
        public const string ResourceKey = "RealmOfAshes/GlobalMapRelief";

        public int SamplesX = 2;
        public int SamplesY = 2;
        public float WidthPoints = 900f;
        public float HeightPoints = 900f;
        public float[] Heights;

        public bool Ready
        {
            get
            {
                return SamplesX >= 2 && SamplesY >= 2
                    && Heights != null && Heights.Length == SamplesX * SamplesY;
            }
        }

        /// <summary>Билинейная высота рельефа в координатах карты (points).</summary>
        public float HeightAt(float pointX, float pointY)
        {
            if (!Ready) return 0f;
            float u = Mathf.Clamp01(pointX / Mathf.Max(1f, WidthPoints)) * (SamplesX - 1);
            float v = Mathf.Clamp01(pointY / Mathf.Max(1f, HeightPoints)) * (SamplesY - 1);
            int x0 = Mathf.Clamp(Mathf.FloorToInt(u), 0, SamplesX - 2);
            int y0 = Mathf.Clamp(Mathf.FloorToInt(v), 0, SamplesY - 2);
            float fx = u - x0;
            float fy = v - y0;
            float a = Heights[y0 * SamplesX + x0];
            float b = Heights[y0 * SamplesX + x0 + 1];
            float c = Heights[(y0 + 1) * SamplesX + x0];
            float d = Heights[(y0 + 1) * SamplesX + x0 + 1];
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }
    }
}
