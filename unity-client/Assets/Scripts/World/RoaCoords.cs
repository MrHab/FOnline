using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Перевод между серверной системой координат (Three.js, правосторонняя, Y вверх)
    /// и Unity (левосторонняя, Y вверх).
    ///
    /// Сервер и вся авторская разметка в data/locations/*.json работают в правосторонней
    /// системе glTF. glTFast при импорте GLB инвертирует ось Z, поэтому весь мир
    /// переводится тем же преобразованием: z_unity = -z_server. Это единственная точка,
    /// где происходит смена систем — ничто другое в клиенте не должно трогать знак Z.
    ///
    /// Углы: сервер хранит angle как atan2(dx, dz) в радианах (0 = взгляд вдоль +Z,
    /// рост против часовой стрелки при взгляде сверху). После инверсии Z поворот
    /// вокруг Y меняет направление, поэтому yaw_unity = 180° - angle_server.
    /// </summary>
    public static class RoaCoords
    {
        /// <summary>Размер тайла в мировых единицах. Соответствует TILE в public/js/game (grid.step = 2).</summary>
        public const float Tile = 2f;

        /// <summary>
        /// Доворот модели персонажа. В Three.js клиент делает rotation.y = angle + PI,
        /// потому что модель смотрит в -Z. После импорта glTFast модель смотрит в +Z,
        /// поэтому доворот нулевой. Ось подтверждается не предположением: проверка
        /// GLB находит глаза/брови на +Z головы, а check-actor-facing сверяет все
        /// четыре направления после z_unity = -z_server.
        /// </summary>
        public const float ModelYawOffsetDeg = 0f;

        public static Vector3 ToUnity(float serverX, float serverY, float serverZ)
            => new Vector3(serverX, serverY, -serverZ);

        public static Vector3 ToUnity(float serverX, float serverZ)
            => new Vector3(serverX, 0f, -serverZ);

        public static void ToServer(Vector3 unityPos, out float serverX, out float serverZ)
        {
            serverX = unityPos.x;
            serverZ = -unityPos.z;
        }

        /// <summary>Серверный angle (радианы) → yaw в Unity (градусы), уже с доворотом модели.</summary>
        public static float AngleToYawDeg(float serverAngleRad)
            => 180f - serverAngleRad * Mathf.Rad2Deg + ModelYawOffsetDeg;

        /// <summary>Yaw в Unity (градусы) → серверный angle (радианы).</summary>
        public static float YawDegToAngle(float unityYawDeg)
            => (180f - (unityYawDeg - ModelYawOffsetDeg)) * Mathf.Deg2Rad;

        public static Quaternion AngleToRotation(float serverAngleRad)
            => Quaternion.Euler(0f, AngleToYawDeg(serverAngleRad), 0f);

        /// <summary>
        /// Авторский Three.js Euler XYZ (радианы) → Unity rotation.
        ///
        /// Отражение Z меняет знаки вращений X/Y, но сохраняет Z. Порядок тоже
        /// существенен: Three.js строит Qx * Qy * Qz, тогда как Quaternion.Euler
        /// использует порядок Unity и расходится, когда одновременно ненулевы
        /// несколько осей.
        /// </summary>
        public static Quaternion AuthoredRotation(float serverXRad, float serverYRad, float serverZRad)
            => Quaternion.AngleAxis(-serverXRad * Mathf.Rad2Deg, Vector3.right)
                * Quaternion.AngleAxis(-serverYRad * Mathf.Rad2Deg, Vector3.up)
                * Quaternion.AngleAxis(serverZRad * Mathf.Rad2Deg, Vector3.forward);

        /// <summary>
        /// Центр тайла в мировых координатах Unity.
        /// Портирует tileToWorld() из public/js/game/02c_map_locations_collision.js:1065.
        /// </summary>
        public static Vector3 TileToWorld(int tx, int tz, int mapWidth, int mapDepth)
        {
            float sx = (tx - mapWidth / 2f + 0.5f) * Tile;
            float sz = (tz - mapDepth / 2f + 0.5f) * Tile;
            return ToUnity(sx, sz);
        }

        /// <summary>
        /// Мировая позиция Unity → индекс тайла.
        /// Портирует worldToTile() из того же файла.
        /// </summary>
        public static void WorldToTile(Vector3 unityPos, int mapWidth, int mapDepth, out int tx, out int tz)
        {
            ToServer(unityPos, out float sx, out float sz);
            tx = Mathf.FloorToInt(sx / Tile + mapWidth / 2f);
            tz = Mathf.FloorToInt(sz / Tile + mapDepth / 2f);
        }

        /// <summary>Скорость (vx, vz) с сервера → вектор скорости в Unity.</summary>
        public static Vector3 VelocityToUnity(float vx, float vz) => new Vector3(vx, 0f, -vz);
    }
}
