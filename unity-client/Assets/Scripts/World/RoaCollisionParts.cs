using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Преграды авторского объекта из collisionParts — те же фигуры, что строит сервер
    /// (src/server/location-collision.js), в серверных метрах. Экспорт сцены пишет туда
    /// то, что останавливает идущего: стены двора — пять полос вокруг открытого
    /// двора, а не один прямоугольник footprint поверх него. Туман и мини-карта
    /// раскладывают их по тайлам так же, как раньше раскладывали footprint.
    /// </summary>
    public static class RoaCollisionParts
    {
        public struct Shape
        {
            public float X, Z, HalfX, HalfZ, Rotation;
            public bool Round;
        }

        // Блоки строительного набора ставятся по сетке и масштаб строки не учитывают.
        private static readonly HashSet<string> ModuleModels = new HashSet<string>(StringComparer.Ordinal)
        {
            "traderWallBlock", "traderWindowBlock", "traderFloorSlab", "traderRoofBlock",
            "wallWoodBlock", "wallBrickBlock", "wallMetalBlock",
            "roofWoodBlock", "roofMetalBlock", "floorWoodBlock", "floorTileBlock"
        };

        /// <summary>Фигуры строки; false — у строки нет collisionParts.</summary>
        public static bool TryShapes(LocationObject entry, List<Shape> shapes)
        {
            shapes.Clear();
            if (entry?.CollisionParts == null || entry.CollisionParts.Count == 0 || entry.Position == null) return false;
            bool module = ModuleModels.Contains(entry.Model ?? string.Empty);
            float scaleX = module || entry.Scale == null ? 1f : entry.Scale.X;
            float scaleZ = module || entry.Scale == null ? 1f : entry.Scale.Z;
            float yaw = entry.Rotation?.Y ?? 0f;
            // transformedBounds() сервера: смещение части поворачивается на -yaw в его 2D-записи.
            float rotation = -yaw;
            float cos = (float)Math.Cos(rotation);
            float sin = (float)Math.Sin(rotation);
            foreach (JToken token in entry.CollisionParts)
            {
                if (!(token is JObject part)) continue;
                JObject center = part["center"] as JObject;
                float centerX = Number(center?["x"] ?? part["x"], 0f);
                float centerZ = Number(center?["z"] ?? part["z"], 0f);
                float localX = centerX * scaleX;
                float localZ = centerZ * scaleZ;
                float x = entry.Position.X + localX * cos - localZ * sin;
                float z = entry.Position.Z + localX * sin + localZ * cos;
                if (part["radius"] != null)
                {
                    float radius = Number(part["radius"], 0f);
                    if (!(radius > 0f)) continue;
                    // Физика масштабирует шар по наибольшей оси, в эллипс он не вытягивается.
                    float worldRadius = radius * Math.Max(Math.Abs(scaleX), Math.Abs(scaleZ));
                    shapes.Add(new Shape { X = x, Z = z, HalfX = worldRadius, HalfZ = worldRadius, Round = true });
                    continue;
                }
                JObject size = part["size"] as JObject;
                float width = Number(size?["x"] ?? size?["width"] ?? part["width"], 0f);
                float depth = Number(size?["z"] ?? size?["depth"] ?? part["depth"], 0f);
                if (!(width > 0f) || !(depth > 0f)) continue;
                shapes.Add(new Shape
                {
                    X = x,
                    Z = z,
                    HalfX = width * Math.Abs(scaleX) * 0.5f,
                    HalfZ = depth * Math.Abs(scaleZ) * 0.5f,
                    Rotation = rotation - Number(part["rotationY"], 0f)
                });
            }
            return shapes.Count > 0;
        }

        /// <summary>Лежит ли точка (серверные метры) внутри фигуры: circleBlockerPenalty() с нулевым радиусом.</summary>
        public static bool Contains(Shape shape, float x, float z)
        {
            float dx = x - shape.X;
            float dz = z - shape.Z;
            if (shape.Round) return dx * dx + dz * dz <= shape.HalfX * shape.HalfX;
            float cos = (float)Math.Cos(-shape.Rotation);
            float sin = (float)Math.Sin(-shape.Rotation);
            float localX = dx * cos - dz * sin;
            float localZ = dx * sin + dz * cos;
            return Math.Abs(localX) <= shape.HalfX && Math.Abs(localZ) <= shape.HalfZ;
        }

        /// <summary>
        /// Тайлы, которых касаются фигуры строки. Тайл отмечен, если в него попадает хоть
        /// одна из девяти точек сетки 3×3: шаг 0,67 м меньше толщины самой тонкой стены
        /// (0,7 м), поэтому стена не рвётся на тайлы с щелями. false — у строки нет частей.
        /// </summary>
        public static bool ForEachTile(LocationObject entry, int mapWidth, int mapDepth, Action<int, int> visit)
        {
            var shapes = new List<Shape>(4);
            if (!TryShapes(entry, shapes)) return false;
            var seen = new HashSet<long>();
            foreach (Shape shape in shapes)
            {
                float reach = shape.Round ? shape.HalfX
                    : (float)Math.Sqrt(shape.HalfX * shape.HalfX + shape.HalfZ * shape.HalfZ);
                int minTx = (int)Math.Floor((shape.X - reach) / RoaCoords.Tile + mapWidth / 2f);
                int maxTx = (int)Math.Floor((shape.X + reach) / RoaCoords.Tile + mapWidth / 2f);
                int minTz = (int)Math.Floor((shape.Z - reach) / RoaCoords.Tile + mapDepth / 2f);
                int maxTz = (int)Math.Floor((shape.Z + reach) / RoaCoords.Tile + mapDepth / 2f);
                for (int tz = Math.Max(0, minTz); tz <= Math.Min(mapDepth - 1, maxTz); tz++)
                {
                    for (int tx = Math.Max(0, minTx); tx <= Math.Min(mapWidth - 1, maxTx); tx++)
                    {
                        long key = (long)tz * mapWidth + tx;
                        if (seen.Contains(key) || !TouchesTile(shape, tx, tz, mapWidth, mapDepth)) continue;
                        seen.Add(key);
                        visit(tx, tz);
                    }
                }
            }
            return true;
        }

        private static bool TouchesTile(Shape shape, int tx, int tz, int mapWidth, int mapDepth)
        {
            float originX = (tx - mapWidth / 2f) * RoaCoords.Tile;
            float originZ = (tz - mapDepth / 2f) * RoaCoords.Tile;
            for (int i = 0; i < 3; i++)
            {
                for (int j = 0; j < 3; j++)
                {
                    float x = originX + (i + 0.5f) * RoaCoords.Tile / 3f;
                    float z = originZ + (j + 0.5f) * RoaCoords.Tile / 3f;
                    if (Contains(shape, x, z)) return true;
                }
            }
            return false;
        }

        private static float Number(JToken token, float fallback)
        {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float value) ? value : fallback;
        }
    }
}
