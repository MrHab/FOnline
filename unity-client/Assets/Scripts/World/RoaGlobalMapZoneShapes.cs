using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Силуэты областей встреч и знака главаря на глобальной карте.
    /// Это не геометрия, а таблица вершин: по ней editor-инструмент печёт
    /// сохранённые меши, а карта тем же контуром проверяет, попал ли курсор
    /// внутрь области. Один источник — значит нарисованная граница и граница
    /// наведения совпадают.
    ///
    /// Вершины нормированы: максимальный радиус равен 1, поэтому во время игры
    /// достаточно масштабировать префаб на радиус области.
    /// </summary>
    public static class RoaGlobalMapZoneShapes
    {
        /// <summary>Ширина обводки контура в долях радиуса области.</summary>
        public const float RimWidth = 0.05f;

        private static readonly Vector2[] ShapeA =
        {
            new Vector2(1.000f, 0.000f),
            new Vector2(0.482f, 0.663f),
            new Vector2(-0.211f, 0.916f),
            new Vector2(-0.634f, 0.296f),
            new Vector2(-0.777f, -0.413f),
            new Vector2(-0.106f, -0.753f),
            new Vector2(0.617f, -0.735f)
        };

        private static readonly Vector2[] ShapeB =
        {
            new Vector2(0.880f, 0.187f),
            new Vector2(0.530f, 0.848f),
            new Vector2(-0.075f, 0.716f),
            new Vector2(-0.678f, 0.529f),
            new Vector2(-0.926f, -0.163f),
            new Vector2(-0.380f, -0.564f),
            new Vector2(0.213f, -0.854f),
            new Vector2(0.663f, -0.447f)
        };

        private static readonly Vector2[] ShapeC =
        {
            new Vector2(0.902f, 0.328f),
            new Vector2(0.207f, 0.773f),
            new Vector2(-0.669f, 0.743f),
            new Vector2(-0.711f, -0.204f),
            new Vector2(-0.315f, -0.865f),
            new Vector2(0.482f, -0.688f)
        };

        private static readonly Vector2[][] Silhouettes = { ShapeA, ShapeB, ShapeC };

        /// <summary>Сколько силуэтов нарисовано. Сервер клампит номер по этому числу.</summary>
        public static int Count { get { return Silhouettes.Length; } }

        /// <summary>Контур области по авторскому номеру (1..Count).</summary>
        public static Vector2[] Silhouette(int shape)
        {
            int index = Mathf.Clamp(shape, 1, Silhouettes.Length) - 1;
            return Silhouettes[index];
        }

        /// <summary>Шестиугольник знака главаря: плоский бейдж, вершина вверх.</summary>
        public static Vector2[] BossBadge()
        {
            var points = new Vector2[6];
            for (int i = 0; i < points.Length; i++)
            {
                float angle = (90f + i * 60f) * Mathf.Deg2Rad;
                points[i] = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle));
            }
            return points;
        }

        /// <summary>
        /// Попадает ли точка внутрь области. Точка задаётся в тех же единицах
        /// глобальной карты, что центр и радиус; поворот — тот же угол, на
        /// который карта поворачивает префаб.
        /// </summary>
        public static bool Contains(int shape, float rotationDegrees, float radius,
                                    Vector2 center, Vector2 point)
        {
            if (radius <= 0.0001f) return false;
            Vector2 local = (point - center) / radius;
            // Карта поворачивает силуэт на rotationDegrees вокруг вертикали,
            // поэтому точка проверяется в системе координат самого силуэта.
            float angle = -rotationDegrees * Mathf.Deg2Rad;
            float cos = Mathf.Cos(angle);
            float sin = Mathf.Sin(angle);
            var rotated = new Vector2(local.x * cos - local.y * sin, local.x * sin + local.y * cos);
            return ContainsLocal(Silhouette(shape), rotated);
        }

        /// <summary>Классический луч: нечётное число пересечений — точка внутри.</summary>
        public static bool ContainsLocal(Vector2[] polygon, Vector2 point)
        {
            if (polygon == null || polygon.Length < 3) return false;
            bool inside = false;
            for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
            {
                Vector2 a = polygon[i];
                Vector2 b = polygon[j];
                if ((a.y > point.y) == (b.y > point.y)) continue;
                float x = (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
                if (point.x < x) inside = !inside;
            }
            return inside;
        }
    }
}
