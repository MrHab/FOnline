using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Какая часть коллайдеров сцены останавливает идущего — так, как это видит сервер:
    /// плоские фигуры на земле. Клиент останавливает игрока самими коллайдерами, сервер —
    /// строкой data, поэтому экспорт пишет эти фигуры в collisionParts, а
    /// src/server/location-collision.js собирает из них преграды.
    ///
    /// Зеркало tools/kromka-walk-collision.js: tools/check-kromka-collision-parity.js
    /// пересчитывает те же фигуры из YAML сцены и сверяет с data, поэтому любая правка
    /// правил здесь обязана повториться там.
    /// </summary>
    internal static class KromkaWalkCollision
    {
        // Игрок — капсула 1,8 м с шагом 0,25 м (RoaPlayerController) на земле, верх которой
        // лежит на y = -0,05 (Ground_EDITABLE). Считается только то, что у коллайдера есть
        // между шагом и головой: под крышей, балкой крана и баком на опорах проходят, а
        // наклонный конвейер мешает лишь там, где лента опускается до роста человека.
        internal const double BandBottom = 0.2;
        internal const double BandTop = 1.75;
        // Полоса тоньше — касание (кромка панели на 5 мм ниже головы), а не преграда.
        internal const double MinPartSize = 0.05;
        private const double Upright = 0.999;
        private const double Horizontal = 0.001;

        internal struct GroundShape
        {
            public bool Round;
            public double X, Z, Radius, SizeX, SizeZ, Yaw;
        }

        /// <summary>Включённые коллайдеры объекта, которые физика действительно учитывает.</summary>
        internal static List<Collider> SolidColliders(GameObject root)
        {
            var result = new List<Collider>();
            if (root == null) return result;
            foreach (Collider collider in root.GetComponentsInChildren<Collider>(true))
                if (collider != null && collider.enabled && !collider.isTrigger && collider.gameObject.activeInHierarchy)
                    result.Add(collider);
            return result;
        }

        /// <summary>Останавливает ли объект идущего: есть ли у него хоть что-то на высоте тела.</summary>
        internal static bool BlocksWalking(GameObject root) => Shapes(root).Count > 0;

        internal static List<GroundShape> Shapes(GameObject root)
        {
            var shapes = new List<GroundShape>();
            foreach (Collider collider in SolidColliders(root))
            {
                GroundShape? shape = ShapeOf(collider);
                if (shape == null) continue;
                GroundShape value = shape.Value;
                if (value.Round ? value.Radius * 2 < MinPartSize : Math.Min(value.SizeX, value.SizeZ) < MinPartSize)
                    continue;
                shapes.Add(value);
            }
            return shapes;
        }

        /// <summary>
        /// collisionParts строки в той системе, в которой их читает сервер: смещение от
        /// позиции строки, развёрнутое обратно на её поворот и делённое на её масштаб.
        /// Позиция, поворот и масштаб берутся уже округлёнными — такими их увидит сервер.
        /// </summary>
        internal static JArray Parts(List<GroundShape> shapes, Vector3 position, double yaw, Vector3 scale)
        {
            double scaleX = Math.Abs(scale.x) > 1e-6 ? scale.x : 1;
            double scaleZ = Math.Abs(scale.z) > 1e-6 ? scale.z : 1;
            double cos = Math.Cos(yaw);
            double sin = Math.Sin(yaw);
            var parts = new JArray();
            foreach (GroundShape shape in shapes)
            {
                double dx = shape.X - position.x;
                double dz = shape.Z - position.z;
                var part = new JObject
                {
                    ["center"] = new JObject
                    {
                        ["x"] = Round((dx * cos - dz * sin) / scaleX),
                        ["z"] = Round((dx * sin + dz * cos) / scaleZ)
                    }
                };
                if (shape.Round)
                {
                    part["radius"] = Round(shape.Radius / Math.Max(Math.Abs(scaleX), Math.Abs(scaleZ)));
                }
                else
                {
                    part["size"] = new JObject
                    {
                        ["x"] = Round(shape.SizeX / Math.Abs(scaleX)),
                        ["z"] = Round(shape.SizeZ / Math.Abs(scaleZ))
                    };
                    double turned = Round(HalfTurn(shape.Yaw - yaw));
                    if (turned != 0) part["rotationY"] = turned;
                }
                parts.Add(part);
            }
            return parts;
        }

        /// <summary>
        /// Размах включённых коллайдеров по земле — footprint строки. Считается из самих
        /// фигур, а не из Collider.bounds, чтобы проверка данных повторяла его без Unity.
        /// </summary>
        internal static bool TryFootprint(GameObject root, out double sizeX, out double sizeZ)
        {
            double minX = double.PositiveInfinity, maxX = double.NegativeInfinity;
            double minZ = double.PositiveInfinity, maxZ = double.NegativeInfinity;
            foreach (Collider collider in SolidColliders(root))
            {
                foreach (Vector3 point in ExtremePoints(collider, out double pad))
                {
                    minX = Math.Min(minX, point.x - pad); maxX = Math.Max(maxX, point.x + pad);
                    minZ = Math.Min(minZ, point.z - pad); maxZ = Math.Max(maxZ, point.z + pad);
                }
            }
            sizeX = maxX - minX;
            sizeZ = maxZ - minZ;
            return !double.IsInfinity(minX);
        }

        private static IEnumerable<Vector3> ExtremePoints(Collider collider, out double pad)
        {
            Transform transform = collider.transform;
            pad = 0;
            if (collider is BoxCollider box) return BoxCorners(transform, box.center, box.size * 0.5f);
            if (collider is SphereCollider sphere)
            {
                pad = sphere.radius * MaxAbs(transform.lossyScale);
                return new[] { transform.TransformPoint(sphere.center) };
            }
            if (collider is CapsuleCollider capsule)
            {
                CapsuleWorld(capsule, out Vector3 center, out Vector3 axis, out double radius, out double straight);
                pad = radius;
                return new[] { center + axis * (float)straight, center - axis * (float)straight };
            }
            throw Unsupported(collider);
        }

        private static GroundShape? ShapeOf(Collider collider)
        {
            Transform transform = collider.transform;
            if (collider is BoxCollider box)
                return BoxShape(BoxCorners(transform, box.center, box.size * 0.5f), transform);

            if (collider is SphereCollider sphere)
            {
                Vector3 center = transform.TransformPoint(sphere.center);
                double radius = sphere.radius * MaxAbs(transform.lossyScale);
                double away = DistanceToBand(center.y, center.y);
                if (away >= radius) return null;
                return new GroundShape { Round = true, X = center.x, Z = center.z, Radius = Math.Sqrt(radius * radius - away * away) };
            }

            if (collider is CapsuleCollider capsule)
            {
                CapsuleWorld(capsule, out Vector3 center, out Vector3 axis, out double radius, out double straight);
                if (Math.Abs(axis.y) > Upright)
                {
                    double away = DistanceToBand(center.y - straight, center.y + straight);
                    if (away >= radius) return null;
                    return new GroundShape { Round = true, X = center.x, Z = center.z, Radius = Math.Sqrt(radius * radius - away * away) };
                }
                if (Math.Abs(axis.y) < Horizontal)
                {
                    // Труба: шириной с хорду круглого сечения на высоте тела, длиной с прямой
                    // участок; скруглённые торцы добавляют сторону вписанного в них квадрата.
                    double away = DistanceToBand(center.y, center.y);
                    if (away >= radius) return null;
                    double chord = Math.Sqrt(radius * radius - away * away);
                    double length = Math.Sqrt((double)axis.x * axis.x + (double)axis.z * axis.z);
                    if (length < 1e-9) length = 1;
                    return new GroundShape
                    {
                        X = center.x,
                        Z = center.z,
                        SizeX = (straight + chord * Math.Sqrt(0.5)) * 2,
                        SizeZ = chord * 2,
                        Yaw = YawOf(axis.x / length, axis.z / length)
                    };
                }
                // У наклонной капсулы простой фигуры нет; её габаритный ящик ошибается в сторону преграды.
                Vector3 half = Vector3.one * capsule.radius;
                half[capsule.direction] = Mathf.Max(capsule.height * 0.5f, capsule.radius);
                return BoxShape(BoxCorners(transform, capsule.center, half), transform);
            }

            throw Unsupported(collider);
        }

        private static void CapsuleWorld(CapsuleCollider capsule, out Vector3 center, out Vector3 axis,
                                         out double radius, out double straight)
        {
            Transform transform = capsule.transform;
            Vector3 scale = transform.lossyScale;
            int direction = capsule.direction;
            int a = (direction + 1) % 3;
            int b = (direction + 2) % 3;
            center = transform.TransformPoint(capsule.center);
            axis = direction == 0 ? transform.right : direction == 1 ? transform.up : transform.forward;
            radius = capsule.radius * Math.Max(Math.Abs(scale[a]), Math.Abs(scale[b]));
            straight = Math.Max(0, capsule.height * Math.Abs(scale[direction]) * 0.5 - radius);
        }

        private static Vector3[] BoxCorners(Transform transform, Vector3 center, Vector3 half)
        {
            var corners = new Vector3[8];
            for (int i = 0; i < 8; i++)
                corners[i] = transform.TransformPoint(center + new Vector3(
                    (i & 1) != 0 ? half.x : -half.x, (i & 2) != 0 ? half.y : -half.y, (i & 4) != 0 ? half.z : -half.z));
            return corners;
        }

        // Срез ящика полосой высот тела, спроецированный на землю и обведённый прямоугольником.
        private static GroundShape? BoxShape(Vector3[] corners, Transform transform)
        {
            var points = new List<double[]>();
            foreach (Vector3 corner in corners)
                if (corner.y >= BandBottom && corner.y <= BandTop) points.Add(new double[] { corner.x, corner.z });
            for (int a = 0; a < 8; a++)
            {
                foreach (int bit in new[] { 1, 2, 4 })
                {
                    if ((a & bit) != 0) continue;
                    Vector3 from = corners[a];
                    Vector3 to = corners[a | bit];
                    foreach (double level in new[] { BandBottom, BandTop })
                    {
                        if ((from.y - level) * (to.y - level) >= 0) continue;
                        double t = (level - from.y) / ((double)to.y - from.y);
                        points.Add(new[] { from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t });
                    }
                }
            }
            if (points.Count == 0) return null;

            // Рамка идёт по самой горизонтальной оси ящика: стоячий или только наклонённый
            // ящик сохраняет собственный прямоугольник, а не больший по осям мира.
            Vector3[] axes = { transform.right, transform.up, transform.forward };
            int level0 = 0;
            for (int index = 1; index < 3; index++)
                if (Math.Abs(axes[index].y) < Math.Abs(axes[level0].y) - 1e-6) level0 = index;
            double length = Math.Sqrt((double)axes[level0].x * axes[level0].x + (double)axes[level0].z * axes[level0].z);
            if (length < 1e-9) length = 1;
            double yaw = YawOf(axes[level0].x / length, axes[level0].z / length);

            double cos = Math.Cos(yaw);
            double sin = Math.Sin(yaw);
            double minU = double.PositiveInfinity, maxU = double.NegativeInfinity;
            double minV = double.PositiveInfinity, maxV = double.NegativeInfinity;
            foreach (double[] point in points)
            {
                double u = point[0] * cos - point[1] * sin;
                double v = point[0] * sin + point[1] * cos;
                minU = Math.Min(minU, u); maxU = Math.Max(maxU, u);
                minV = Math.Min(minV, v); maxV = Math.Max(maxV, v);
            }
            double centerU = (minU + maxU) * 0.5;
            double centerV = (minV + maxV) * 0.5;
            return new GroundShape
            {
                X = centerU * cos + centerV * sin,
                Z = -centerU * sin + centerV * cos,
                SizeX = maxU - minU,
                SizeZ = maxV - minV,
                Yaw = yaw
            };
        }

        // Поворот Unity вокруг Y, при котором локальная ось X смотрит вдоль (x, z) по земле.
        private static double YawOf(double x, double z) => Math.Atan2(-z, x);

        // Прямоугольник, повёрнутый на пол-оборота, — тот же прямоугольник.
        private static double HalfTurn(double angle)
        {
            double value = angle % Math.PI;
            if (value > Math.PI / 2) value -= Math.PI;
            if (value <= -Math.PI / 2) value += Math.PI;
            return value;
        }

        private static double DistanceToBand(double low, double high)
        {
            if (high < BandBottom) return BandBottom - high;
            if (low > BandTop) return low - BandTop;
            return 0;
        }

        private static double MaxAbs(Vector3 value) =>
            Math.Max(Math.Abs(value.x), Math.Max(Math.Abs(value.y), Math.Abs(value.z)));

        internal static double Round(double value)
        {
            double rounded = Math.Round(value, 3, MidpointRounding.AwayFromZero);
            return rounded == 0 ? 0 : rounded;
        }

        private static Exception Unsupported(Collider collider) => new InvalidOperationException(
            "Коллайдер " + collider.GetType().Name + " объекта " + collider.name
            + " не имеет серверной формы: сцены Кромки собираются из Box, Sphere и Capsule.");
    }
}
