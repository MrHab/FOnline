using System;
using System.Collections.Generic;

// Дифференциальная проверка тумана войны.
//
// Слева — дословная транскрипция web-клиента (09_update_fog_movement_ai.js),
// справа — алгоритм, перенесённый в RoaFogOfWar.cs. Оба гоняются по одним
// и тем же случайным картам, ответы сравниваются потайлово.
//
// Смысл именно в различающем тесте: обе реализации написаны рукой, и совпадение
// на десятках тысяч случаев — единственное доказательство, что перенос точен.

internal static class Program
{
    private const int W = 24;
    private const int H = 24;

    private static bool[,] _full = new bool[W, H];
    private static bool[,] _cover = new bool[W, H];

    private static bool InBounds(int x, int z) => x >= 0 && z >= 0 && x < W && z < H;

    private static bool Blocking(int x, int z, bool observerCrouching)
        => _full[x, z] || (observerCrouching && _cover[x, z]);

    // ------------------------------------------------------------------
    // Эталон: транскрипция JS
    // ------------------------------------------------------------------

    private static List<(int tx, int tz)> RefLineTilesBetween(int startTx, int startTz, int endTx, int endTz)
    {
        var tiles = new List<(int, int)>();
        int x0 = startTx, z0 = startTz;
        int dx = Math.Abs(endTx - x0), dz = Math.Abs(endTz - z0);
        int sx = x0 < endTx ? 1 : -1, sz = z0 < endTz ? 1 : -1;
        int err = dx - dz;

        while (true)
        {
            if (x0 == endTx && z0 == endTz) return tiles;
            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x0 += sx; }
            if (e2 < dx) { err += dx; z0 += sz; }
            if (!InBounds(x0, z0)) return tiles;
            tiles.Add((x0, z0));
        }
    }

    private static void RefMarkVisibilityRay(HashSet<int> visible, int startTx, int startTz,
                                             int endTx, int endTz, bool crouch)
    {
        int x0 = startTx, z0 = startTz;
        int dx = Math.Abs(endTx - x0), dz = Math.Abs(endTz - z0);
        int sx = x0 < endTx ? 1 : -1, sz = z0 < endTz ? 1 : -1;
        int err = dx - dz;

        while (true)
        {
            if (!InBounds(x0, z0)) return;
            visible.Add(z0 * 4096 + x0);

            if (x0 == endTx && z0 == endTz) return;
            if (!(x0 == startTx && z0 == startTz) && Blocking(x0, z0, crouch)) return;

            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x0 += sx; }
            if (e2 < dx) { err += dx; z0 += sz; }
        }
    }

    private static HashSet<int> RefRebuild(int startTx, int startTz, int radius, bool crouch)
    {
        var visible = new HashSet<int>();

        for (int dz = -radius; dz <= radius; dz++)
        for (int dx = -radius; dx <= radius; dx++)
        {
            int tx = startTx + dx, tz = startTz + dz;
            if (!InBounds(tx, tz)) continue;
            if (dx * dx + dz * dz > radius * radius) continue;
            RefMarkVisibilityRay(visible, startTx, startTz, tx, tz, crouch);
        }

        return visible;
    }

    private static bool RefStrictLos(int startTx, int startTz, int endTx, int endTz, bool crouch)
    {
        int x0 = startTx, z0 = startTz;
        int dx = Math.Abs(endTx - x0), dz = Math.Abs(endTz - z0);
        int sx = x0 < endTx ? 1 : -1, sz = z0 < endTz ? 1 : -1;
        int err = dx - dz;

        while (true)
        {
            if (!InBounds(x0, z0)) return false;
            if (x0 == endTx && z0 == endTz) return true;

            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x0 += sx; }
            if (e2 < dx) { err += dx; z0 += sz; }

            if (!InBounds(x0, z0)) return false;
            if (x0 == endTx && z0 == endTz) return true;
            if (Blocking(x0, z0, crouch)) return false;
        }
    }

    private static bool RefCrouchHidden(int startTx, int startTz, int targetTx, int targetTz)
    {
        if (startTx == targetTx && startTz == targetTz) return false;

        var line = RefLineTilesBetween(startTx, startTz, targetTx, targetTz);

        for (int i = 0; i < line.Count; i++)
        {
            var tile = line[i];
            if (tile.tx == targetTx && tile.tz == targetTz) return false;
            if (!_cover[tile.tx, tile.tz]) continue;

            if (i + 1 < line.Count)
            {
                var next = line[i + 1];
                if (next.tx == targetTx && next.tz == targetTz) return true;
            }
        }

        return false;
    }

    private static bool RefVisible(HashSet<int> visible, int px, int pz, int radius, bool crouch,
                                   int tx, int tz, bool targetCrouching)
    {
        if (!InBounds(tx, tz)) return false;

        int dx = tx - px, dz = tz - pz;
        if (dx * dx + dz * dz > radius * radius) return false;

        if (!visible.Contains(tz * 4096 + tx)) return false;
        if (!RefStrictLos(px, pz, tx, tz, crouch)) return false;
        if (targetCrouching && RefCrouchHidden(px, pz, tx, tz)) return false;

        return true;
    }

    // ------------------------------------------------------------------
    // Порт: скопировано из RoaFogOfWar.cs
    // ------------------------------------------------------------------

    private static int Key(int tx, int tz) => tz * 4096 + tx;

    private static void PortMarkRay(HashSet<int> visible, HashSet<int> explored,
                                    int startTx, int startTz, int endTx, int endTz, bool crouching)
    {
        int x = startTx, z = startTz;
        int dx = Math.Abs(endTx - x), dz = Math.Abs(endTz - z);
        int sx = x < endTx ? 1 : -1, sz = z < endTz ? 1 : -1;
        int err = dx - dz;

        while (true)
        {
            if (!InBounds(x, z)) return;

            int key = Key(x, z);
            visible.Add(key);
            explored.Add(key);

            if (x == endTx && z == endTz) return;

            bool isStart = x == startTx && z == startTz;
            if (!isStart && Blocking(x, z, crouching)) return;

            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x += sx; }
            if (e2 < dx) { err += dx; z += sz; }
        }
    }

    private static HashSet<int> PortRebuild(int tx, int tz, int radius, bool crouching)
    {
        var visible = new HashSet<int>();
        var explored = new HashSet<int>();

        for (int dz = -radius; dz <= radius; dz++)
        for (int dx = -radius; dx <= radius; dx++)
        {
            int x = tx + dx, z = tz + dz;
            if (!InBounds(x, z)) continue;
            if (dx * dx + dz * dz > radius * radius) continue;
            PortMarkRay(visible, explored, tx, tz, x, z, crouching);
        }

        return visible;
    }

    private static bool PortStrictLos(int startTx, int startTz, int endTx, int endTz, bool observerCrouching)
    {
        int x = startTx, z = startTz;
        int dx = Math.Abs(endTx - x), dz = Math.Abs(endTz - z);
        int sx = x < endTx ? 1 : -1, sz = z < endTz ? 1 : -1;
        int err = dx - dz;

        while (true)
        {
            if (!InBounds(x, z)) return false;
            if (x == endTx && z == endTz) return true;

            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x += sx; }
            if (e2 < dx) { err += dx; z += sz; }

            if (!InBounds(x, z)) return false;
            if (x == endTx && z == endTz) return true;
            if (Blocking(x, z, observerCrouching)) return false;
        }
    }

    private static bool PortHiddenByLowCover(int startTx, int startTz, int targetTx, int targetTz)
    {
        if (startTx == targetTx && startTz == targetTz) return false;

        int x = startTx, z = startTz;
        int dx = Math.Abs(targetTx - x), dz = Math.Abs(targetTz - z);
        int sx = x < targetTx ? 1 : -1, sz = z < targetTz ? 1 : -1;
        int err = dx - dz;

        bool previousIsObserver = true;
        int previousX = 0, previousZ = 0;

        while (true)
        {
            int e2 = err * 2;
            if (e2 > -dz) { err -= dz; x += sx; }
            if (e2 < dx) { err += dx; z += sz; }

            if (!InBounds(x, z)) return false;

            if (x == targetTx && z == targetTz)
                return !previousIsObserver && _cover[previousX, previousZ];

            previousX = x;
            previousZ = z;
            previousIsObserver = false;
        }
    }

    private static bool PortVisible(HashSet<int> visible, int px, int pz, int radius, bool crouch,
                                    int tx, int tz, bool targetCrouching)
    {
        if (!InBounds(tx, tz)) return false;

        int dx = tx - px, dz = tz - pz;
        if (dx * dx + dz * dz > radius * radius) return false;

        if (!visible.Contains(Key(tx, tz))) return false;
        if (!PortStrictLos(px, pz, tx, tz, crouch)) return false;
        if (targetCrouching && PortHiddenByLowCover(px, pz, tx, tz)) return false;

        return true;
    }

    // ------------------------------------------------------------------
    // Точные OBB авторских GLB: 02c_map_locations_collision.js:1263.
    // ------------------------------------------------------------------

    private readonly struct ExactBox
    {
        public readonly double X, Z, HalfX, HalfZ, Rotation;
        public ExactBox(double x, double z, double halfX, double halfZ, double rotation)
            => (X, Z, HalfX, HalfZ, Rotation) = (x, z, halfX, halfZ, rotation);
    }

    private static bool RefExactHit(ExactBox box, double x1, double z1, double x2, double z2,
                                    out double nearHit, out double farHit, out double maxRange)
    {
        double dx = x2 - x1, dz = z2 - z1;
        maxRange = Math.Sqrt(dx * dx + dz * dz);
        nearHit = farHit = 0;
        if (!double.IsFinite(maxRange) || maxRange <= 0.001) return false;

        double unitX = dx / maxRange, unitZ = dz / maxRange;
        double relX = x1 - box.X, relZ = z1 - box.Z;
        double cos = Math.Cos(box.Rotation), sin = Math.Sin(box.Rotation);
        double[] origins = { relX * cos + relZ * sin, -relX * sin + relZ * cos };
        double[] directions = { unitX * cos + unitZ * sin, -unitX * sin + unitZ * cos };
        double[] halves = { box.HalfX, box.HalfZ };
        double tMin = 0.02, tMax = maxRange - 0.02;

        for (int axis = 0; axis < 2; axis++)
        {
            double origin = origins[axis], direction = directions[axis], half = halves[axis];
            if (Math.Abs(direction) < 0.00001)
            {
                if (origin < -half || origin > half) return false;
                continue;
            }
            double near = (-half - origin) / direction;
            double far = (half - origin) / direction;
            if (near > far) (near, far) = (far, near);
            tMin = Math.Max(tMin, near);
            tMax = Math.Min(tMax, far);
            if (tMin > tMax) return false;
        }

        if (tMax < 0.02 || tMin >= maxRange - 0.02) return false;
        nearHit = tMin;
        farHit = tMax;
        return true;
    }

    private static bool PortExactHit(ExactBox box, double x1, double z1, double x2, double z2,
                                     out double nearHit, out double farHit, out double maxRange)
    {
        double dx = x2 - x1, dz = z2 - z1;
        maxRange = Math.Sqrt(dx * dx + dz * dz);
        nearHit = farHit = 0;
        if (maxRange <= 0.001) return false;

        double directionX = dx / maxRange, directionZ = dz / maxRange;
        double cos = Math.Cos(-box.Rotation), sin = Math.Sin(-box.Rotation);
        double localOriginX = (x1 - box.X) * cos - (z1 - box.Z) * sin;
        double localOriginZ = (x1 - box.X) * sin + (z1 - box.Z) * cos;
        double localDirectionX = directionX * cos - directionZ * sin;
        double localDirectionZ = directionX * sin + directionZ * cos;
        double tMin = 0.02, tMax = maxRange - 0.02;

        if (!PortClipAxis(localOriginX, localDirectionX, -box.HalfX, box.HalfX, ref tMin, ref tMax)
            || !PortClipAxis(localOriginZ, localDirectionZ, -box.HalfZ, box.HalfZ, ref tMin, ref tMax))
            return false;
        if (tMax < 0.02 || tMin >= maxRange - 0.02) return false;
        nearHit = tMin;
        farHit = tMax;
        return true;
    }

    private static bool PortClipAxis(double origin, double direction, double minimum, double maximum,
                                     ref double tMin, ref double tMax)
    {
        if (Math.Abs(direction) < 0.00001) return origin >= minimum && origin <= maximum;
        double near = (minimum - origin) / direction;
        double far = (maximum - origin) / direction;
        if (near > far) (near, far) = (far, near);
        tMin = Math.Max(tMin, near);
        tMax = Math.Min(tMax, far);
        return tMin <= tMax;
    }

    // ------------------------------------------------------------------
    // Тайловая баллистика: server.js roomBlockingDistanceOnRay() против
    // RoaFogOfWar.TerrainBlocksBallisticLine(), включая инверсию Unity Z.
    // ------------------------------------------------------------------

    private static bool RefTerrainBallisticBlocked(double startX, double startZ,
        double endX, double endZ, bool crouching, double endPadding)
    {
        double dx = endX - startX, dz = endZ - startZ;
        double distance = Math.Sqrt(dx * dx + dz * dz);
        if (distance < 0.15) return false;
        double checkDistance = Math.Max(0.15, distance - Math.Max(0, endPadding));
        dx /= distance;
        dz /= distance;
        const double step = 0.45;
        for (double d = step; d <= checkDistance; d += step)
        {
            int tx = (int)Math.Floor((startX + dx * d) / 2.0 + W / 2.0);
            int tz = (int)Math.Floor((startZ + dz * d) / 2.0 + H / 2.0);
            bool blocked = !InBounds(tx, tz) || Blocking(tx, tz, crouching);
            if (!blocked) continue;
            double clearDistance = Math.Max(0.1, d - step * 0.5);
            return clearDistance + 0.35 < checkDistance;
        }
        return false;
    }

    private static bool PortTerrainBallisticBlocked(float startX, float startUnityZ,
        float endX, float endUnityZ, bool crouching, float endPadding)
    {
        float dx = endX - startX, unityDz = endUnityZ - startUnityZ;
        float distance = MathF.Sqrt(dx * dx + unityDz * unityDz);
        if (distance < 0.15f) return false;
        float checkDistance = MathF.Max(0.15f, distance - MathF.Max(0f, endPadding));
        dx /= distance;
        unityDz /= distance;
        const float step = 0.45f;
        for (float d = step; d <= checkDistance; d += step)
        {
            float sampleX = startX + dx * d;
            float sampleUnityZ = startUnityZ + unityDz * d;
            int tx = (int)MathF.Floor(sampleX / 2f + W / 2f);
            int tz = (int)MathF.Floor((-sampleUnityZ) / 2f + H / 2f);
            bool blocked = !InBounds(tx, tz) || Blocking(tx, tz, crouching);
            if (!blocked) continue;
            float clearDistance = MathF.Max(0.1f, d - step * 0.5f);
            return clearDistance + 0.35f < checkDistance;
        }
        return false;
    }

    // ------------------------------------------------------------------

    private static int Main()
    {
        var random = new Random(20260819);
        int mismatches = 0;
        int checks = 0;
        int hiddenCases = 0;
        int blockedCases = 0;
        int exactHits = 0;
        int ballisticBlocks = 0;

        for (int trial = 0; trial < 400; trial++)
        {
            _full = new bool[W, H];
            _cover = new bool[W, H];

            // Плотность специально разная: от почти пустой площадки до лабиринта.
            double fullDensity = random.NextDouble() * 0.18;
            double coverDensity = random.NextDouble() * 0.22;

            for (int z = 0; z < H; z++)
            for (int x = 0; x < W; x++)
            {
                if (random.NextDouble() < fullDensity) _full[x, z] = true;
                else if (random.NextDouble() < coverDensity) _cover[x, z] = true;
            }

            int px = random.Next(W), pz = random.Next(H);

            // Стену под игроком убираем — стоять в ней нельзя. Низкое укрытие
            // оставляем: оно проходимо (authoredObjectBlocksMovement, 02a:1898),
            // и наблюдатель вполне может стоять на ящике.
            _full[px, pz] = false;

            bool crouch = random.Next(2) == 0;
            int radius = random.Next(3, 10);

            HashSet<int> refVisible = RefRebuild(px, pz, radius, crouch);
            HashSet<int> portVisible = PortRebuild(px, pz, radius, crouch);

            if (!refVisible.SetEquals(portVisible))
            {
                Console.WriteLine($"РАСХОЖДЕНИЕ наборов: игрок ({px},{pz}) r={radius} присед={crouch}: "
                    + $"эталон {refVisible.Count}, порт {portVisible.Count}");
                mismatches++;
                continue;
            }

            for (int z = 0; z < H; z++)
            for (int x = 0; x < W; x++)
            foreach (bool targetCrouching in new[] { false, true })
            {
                bool a = RefVisible(refVisible, px, pz, radius, crouch, x, z, targetCrouching);
                bool b = PortVisible(portVisible, px, pz, radius, crouch, x, z, targetCrouching);
                checks++;

                if (a != b)
                {
                    if (mismatches < 10)
                        Console.WriteLine($"РАСХОЖДЕНИЕ: игрок ({px},{pz}) r={radius} присед={crouch} "
                            + $"цель ({x},{z}) приседает={targetCrouching}: эталон={a} порт={b}");
                    mismatches++;
                }

                if (a) blockedCases++;
                if (targetCrouching && RefCrouchHidden(px, pz, x, z)) hiddenCases++;
            }
        }

        for (int i = 0; i < 120000; i++)
        {
            var box = new ExactBox(
                random.NextDouble() * 40 - 20,
                random.NextDouble() * 40 - 20,
                random.NextDouble() * 3.8 + 0.1,
                random.NextDouble() * 3.8 + 0.1,
                random.NextDouble() * Math.PI * 2 - Math.PI);
            double x1 = random.NextDouble() * 60 - 30;
            double z1 = random.NextDouble() * 60 - 30;
            double x2 = random.NextDouble() * 60 - 30;
            double z2 = random.NextDouble() * 60 - 30;

            bool a = RefExactHit(box, x1, z1, x2, z2, out double an, out double af, out double ar);
            bool b = PortExactHit(box, x1, z1, x2, z2, out double bn, out double bf, out double br);
            bool intervalMismatch = a && (Math.Abs(an - bn) > 0.000001
                || Math.Abs(af - bf) > 0.000001 || Math.Abs(ar - br) > 0.000001);
            bool refLowCover = a && ar - af <= 2.0 * 1.25;
            bool portLowCover = b && br - bf <= 2.0 * 1.25;
            if (a != b || intervalMismatch || refLowCover != portLowCover)
            {
                if (mismatches < 10)
                    Console.WriteLine($"РАСХОЖДЕНИЕ OBB #{i}: эталон={a} [{an:F5},{af:F5}] "
                        + $"порт={b} [{bn:F5},{bf:F5}]");
                mismatches++;
            }
            if (a) exactHits++;
        }

        _full = new bool[W, H];
        _cover = new bool[W, H];
        for (int z = 0; z < H; z++)
        for (int x = 0; x < W; x++)
        {
            double roll = random.NextDouble();
            if (roll < 0.15) _full[x, z] = true;
            else if (roll < 0.36) _cover[x, z] = true;
        }

        for (int i = 0; i < 120000; i++)
        {
            double x1 = random.NextDouble() * 56 - 28;
            double z1 = random.NextDouble() * 56 - 28;
            double x2 = random.NextDouble() * 56 - 28;
            double z2 = random.NextDouble() * 56 - 28;
            double endPadding = random.NextDouble() * 1.4;
            bool crouching = random.Next(2) == 0;
            bool a = RefTerrainBallisticBlocked(x1, z1, x2, z2, crouching, endPadding);
            bool b = PortTerrainBallisticBlocked((float)x1, (float)-z1,
                (float)x2, (float)-z2, crouching, (float)endPadding);
            if (a != b)
            {
                if (mismatches < 10)
                    Console.WriteLine($"РАСХОЖДЕНИЕ баллистики #{i}: эталон={a}, порт={b}, "
                        + $"присед={crouching}, ({x1:F4},{z1:F4})→({x2:F4},{z2:F4})");
                mismatches++;
            }
            if (a) ballisticBlocks++;
        }

        Console.WriteLine($"Сверено {checks} запросов видимости на 400 картах.");
        Console.WriteLine($"Видимых исходов: {blockedCases}. Случаев «присевший скрыт укрытием»: {hiddenCases}.");
        Console.WriteLine($"Сверено 120000 лучей по точным OBB; пересечений: {exactHits}.");
        Console.WriteLine($"Сверено 120000 тайловых баллистических лучей; блокировок: {ballisticBlocks}.");

        if (hiddenCases == 0)
        {
            // Иначе тест «прошёл бы», ни разу не задев проверяемую ветку.
            Console.WriteLine("ПРОВАЛ: ветка низкого укрытия ни разу не сработала — тест ничего не проверил.");
            return 1;
        }

        if (exactHits == 0)
        {
            Console.WriteLine("ПРОВАЛ: ветка точного OBB ни разу не сработала — тест ничего не проверил.");
            return 1;
        }

        if (ballisticBlocks == 0)
        {
            Console.WriteLine("ПРОВАЛ: тайловая баллистика ни разу не заблокировала луч — тест ничего не проверил.");
            return 1;
        }

        if (mismatches > 0)
        {
            Console.WriteLine($"ПРОВАЛ: расхождений {mismatches}.");
            return 1;
        }

        Console.WriteLine("Порт совпадает с web-клиентом на всех случаях.");
        return 0;
    }
}
