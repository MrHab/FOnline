using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Перевод между серверной системой координат и Unity.
    ///
    /// Мир Кромки строится в Unity: KromkaWorldSceneExporter пишет в data/locations
    /// мировые координаты сцены как есть, и сервер считает в них же — движение,
    /// преграды из collisionParts, точки прибытия, NPC. Поэтому перевод тождественный:
    /// x, y и z сервера — это x, y и z сцены, а север — +Z (как на глобальной карте
    /// и в виде сверху редактора). Прежний клиент зеркалил Z (правило времён
    /// Three.js), и всё, что ставит сервер, стояло в зеркальном отражении сцены:
    /// игрок появлялся у каравана вместо точки прибытия, NPC — вдали от своих мест.
    ///
    /// Углы: сервер хранит angle как atan2(dx, dz) в радианах (0 = взгляд вдоль +Z,
    /// рост к +X). Это и есть yaw Unity: модели после импорта glTFast смотрят в +Z.
    /// </summary>
    public static class RoaCoords
    {
        /// <summary>Размер тайла в мировых единицах (grid.step = 2 в данных локаций).</summary>
        public const float Tile = 2f;

        /// <summary>
        /// Доворот модели персонажа. После импорта glTFast модель смотрит в +Z,
        /// поэтому доворот нулевой. Ось подтверждается не предположением: проверка
        /// GLB находит глаза/брови на +Z головы, а check-actor-facing сверяет все
        /// четыре направления.
        /// </summary>
        public const float ModelYawOffsetDeg = 0f;

        public static Vector3 ToUnity(float serverX, float serverY, float serverZ)
            => new Vector3(serverX, serverY, serverZ);

        public static Vector3 ToUnity(float serverX, float serverZ)
            => new Vector3(serverX, 0f, serverZ);

        public static void ToServer(Vector3 unityPos, out float serverX, out float serverZ)
        {
            serverX = unityPos.x;
            serverZ = unityPos.z;
        }

        /// <summary>Серверный angle (радианы) → yaw в Unity (градусы), уже с доворотом модели.</summary>
        public static float AngleToYawDeg(float serverAngleRad)
            => serverAngleRad * Mathf.Rad2Deg + ModelYawOffsetDeg;

        /// <summary>Yaw в Unity (градусы) → серверный angle (радианы).</summary>
        public static float YawDegToAngle(float unityYawDeg)
            => (unityYawDeg - ModelYawOffsetDeg) * Mathf.Deg2Rad;

        public static Quaternion AngleToRotation(float serverAngleRad)
            => Quaternion.Euler(0f, AngleToYawDeg(serverAngleRad), 0f);

        /// <summary>
        /// Авторский поворот строки data (радианы) → Unity rotation. Экспорт сцены
        /// пишет transform.eulerAngles, поэтому это те же углы Эйлера Unity.
        /// </summary>
        public static Quaternion AuthoredRotation(float xRad, float yRad, float zRad)
            => Quaternion.Euler(xRad * Mathf.Rad2Deg, yRad * Mathf.Rad2Deg, zRad * Mathf.Rad2Deg);

        /// <summary>Центр тайла в мировых координатах Unity (tileToWorld() сервера).</summary>
        public static Vector3 TileToWorld(int tx, int tz, int mapWidth, int mapDepth)
        {
            float sx = (tx - mapWidth / 2f + 0.5f) * Tile;
            float sz = (tz - mapDepth / 2f + 0.5f) * Tile;
            return ToUnity(sx, sz);
        }

        /// <summary>Мировая позиция Unity → индекс тайла (worldToTile() сервера).</summary>
        public static void WorldToTile(Vector3 unityPos, int mapWidth, int mapDepth, out int tx, out int tz)
        {
            ToServer(unityPos, out float sx, out float sz);
            tx = Mathf.FloorToInt(sx / Tile + mapWidth / 2f);
            tz = Mathf.FloorToInt(sz / Tile + mapDepth / 2f);
        }

        /// <summary>Скорость (vx, vz) с сервера → вектор скорости в Unity.</summary>
        public static Vector3 VelocityToUnity(float vx, float vz) => new Vector3(vx, 0f, vz);
    }
}
