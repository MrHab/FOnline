using System;
using System.Collections.Generic;
using Object = UnityEngine.Object;
using System.Text;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Проверяет туман войны на настоящих данных локаций, не запуская игру.
    ///
    /// Смысл в том, чтобы отвечать числами на конкретные вопросы: сколько тайлов
    /// перекрывает обзор, каков радиус при разном восприятии, и рвёт ли стена
    /// линию видимости. Ни один из серьёзных промахов этого переноса компилятор
    /// не поймал — их ловил только запуск, и вот такие проверки его заменяют.
    /// </summary>
    public static class RoaFogProbe
    {
        private const string LocationsPath = "../data/locations";
        private static readonly HashSet<string> ExplicitVisionCollisions = new HashSet<string>
        {
            "solid", "block", "blocked", "wall", "resource", "cover"
        };

        /// <summary>
        /// Строгая CI-проба: все статические физические объекты обязаны явно
        /// сказать, перекрывают ли они обзор. Это не даёт одинаковой модели
        /// становиться укрытием в одной локации и прозрачной в другой.
        /// </summary>
        public static void Run()
        {
            string root = LocationsRoot();
            if (!System.IO.Directory.Exists(root))
                throw new InvalidOperationException("location data directory is missing: " + root);

            string[] files = System.IO.Directory.GetFiles(root, "*.json");
            Array.Sort(files, StringComparer.Ordinal);
            int required = 0;
            int block = 0;
            int cover = 0;
            int clear = 0;
            var expected = new Dictionary<string, RoaAuthoredVision.Kind>
            {
                { "oldDepot/depot_scrap_01", RoaAuthoredVision.Kind.Cover },
                { "relayStation/relay_antenna_01", RoaAuthoredVision.Kind.Cover },
                { "resourceOldKlimFarm/farm_patch_01", RoaAuthoredVision.Kind.Clear }
            };
            var found = new HashSet<string>();

            foreach (string file in files)
            {
                LocationDefinition location = JsonConvert.DeserializeObject<LocationDefinition>(
                    System.IO.File.ReadAllText(file));
                if (location == null || location.Objects == null)
                    throw new InvalidOperationException(System.IO.Path.GetFileName(file)
                        + " has no location objects");

                string locationId = System.IO.Path.GetFileNameWithoutExtension(file);
                foreach (LocationObject entry in location.Objects)
                {
                    if (entry == null || entry.IsLiveEntity()) continue;
                    string collision = (entry.Collision ?? string.Empty).Trim().ToLowerInvariant();
                    RoaAuthoredVision.Kind kind = RoaAuthoredVision.Resolve(entry);
                    if (ExplicitVisionCollisions.Contains(collision))
                    {
                        required++;
                        if (entry.Vision == null)
                            throw new InvalidOperationException(locationId + "/" + entry.Id
                                + " has physical collision without explicit vision");
                        if (collision == "cover" && kind != RoaAuthoredVision.Kind.Cover)
                            throw new InvalidOperationException(locationId + "/" + entry.Id
                                + " has incompatible cover collision and vision");
                        if (kind == RoaAuthoredVision.Kind.Block) block++;
                        else if (kind == RoaAuthoredVision.Kind.Cover) cover++;
                        else clear++;
                    }

                    string model = (entry.Model ?? string.Empty).Trim().ToLowerInvariant();
                    if (collision == "resource"
                        && (model == "scrapheap" || model == "oreoutcrop"
                            || model == "deadtreeb" || model == "deadwood")
                        && kind != RoaAuthoredVision.Kind.Cover)
                        throw new InvalidOperationException(locationId + "/" + entry.Id
                            + " physical resource is not low cover");
                    if (collision == "resource" && model == "gardenpatch"
                        && kind != RoaAuthoredVision.Kind.Clear)
                        throw new InvalidOperationException(locationId + "/" + entry.Id
                            + " low garden patch blocks sight");

                    string key = locationId + "/" + entry.Id;
                    if (expected.TryGetValue(key, out RoaAuthoredVision.Kind wanted))
                    {
                        if (kind != wanted)
                            throw new InvalidOperationException(key + " resolves to " + kind
                                + " instead of " + wanted);
                        found.Add(key);
                    }
                }
            }

            if (found.Count != expected.Count)
                throw new InvalidOperationException("authored LOS fixtures are missing");

            var host = new GameObject("RoaFogAudit");
            host.hideFlags = HideFlags.HideAndDontSave;
            try
            {
                string lineReport = LineOfSightCheck(host, out bool lineOfSightOk);
                if (!lineOfSightOk) throw new InvalidOperationException(lineReport);
            }
            finally
            {
                Object.DestroyImmediate(host);
            }

            Debug.Log("[ТУМАН ВОЙНЫ] готово: " + files.Length + " локаций, "
                + required + " статических правил (стены/укрытия/сквозные="
                + block + "/" + cover + "/" + clear + "), синтетический LOS сходится.");
        }

        private static string LocationsRoot()
        {
            return System.IO.Path.GetFullPath(
                System.IO.Path.Combine(Application.dataPath, "..", LocationsPath));
        }

        [MenuItem("Realm of Ashes/Проверить туман войны")]
        public static void Probe()
        {
            string root = LocationsRoot();

            if (!System.IO.Directory.Exists(root))
            {
                Debug.LogError("[ROA] Папка локаций не найдена: " + root);
                return;
            }

            string[] files = System.IO.Directory.GetFiles(root, "*.json");
            var report = new StringBuilder();
            report.AppendLine("[ROA] Туман войны — проверка на " + files.Length + " локациях");

            var host = new GameObject("RoaFogProbe");
            host.hideFlags = HideFlags.HideAndDontSave;

            try
            {
                var fog = host.AddComponent<RoaFogOfWar>();
                int totalBlock = 0;
                int totalCover = 0;
                int silent = 0;

                foreach (string file in files)
                {
                    LocationDefinition location;

                    try
                    {
                        location = JsonConvert.DeserializeObject<LocationDefinition>(
                            System.IO.File.ReadAllText(file));
                    }
                    catch (System.Exception error)
                    {
                        Debug.LogError("[ROA] " + System.IO.Path.GetFileName(file) + " не разобран: " + error.Message);
                        continue;
                    }

                    if (location == null || location.Objects == null) continue;

                    int block = 0;
                    int cover = 0;
                    int clear = 0;

                    foreach (LocationObject entry in location.Objects)
                    {
                        if (entry == null || entry.IsLiveEntity()) continue;

                        switch (RoaAuthoredVision.Resolve(entry))
                        {
                            case RoaAuthoredVision.Kind.Block: block++; break;
                            case RoaAuthoredVision.Kind.Cover: cover++; break;
                            default: clear++; break;
                        }
                    }

                    totalBlock += block;
                    totalCover += cover;

                    if (block == 0 && cover == 0)
                    {
                        // Локация без единого препятствия — это либо голая
                        // площадка, либо промах в разборе разметки. Молчать нельзя.
                        silent++;
                        report.AppendLine("  ! " + location.Id + ": обзор не перекрывает ничто из "
                            + location.Objects.Count + " объектов");
                        continue;
                    }

                    report.AppendLine("  " + location.Id + ": стен " + block + ", укрытий " + cover
                        + ", прозрачных " + clear);
                }

                report.AppendLine("Итого: стен " + totalBlock + ", укрытий " + totalCover
                    + ", локаций без препятствий " + silent);

                report.AppendLine();
                report.AppendLine("Радиус обзора (тайлов) по восприятию:");

                foreach (int per in new[] { 1, 5, 8, 10, 15 })
                {
                    fog.Perception = per;
                    fog.Vigilance = 0;

                    int standing = fog.ComputeRadius(false, false, false);
                    int crouched = fog.ComputeRadius(true, false, false);

                    fog.Vigilance = 2;
                    int vigilant = fog.ComputeRadius(false, false, false);

                    report.AppendLine("  PER " + per + ": стоя " + standing
                        + ", присев " + crouched + ", с бдительностью 2 — " + vigilant);
                }

                report.AppendLine();
                report.AppendLine(LineOfSightCheck(host));

                Debug.Log(report.ToString());
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }

        /// <summary>
        /// Синтетическая сцена: стена поперёк пути. Проверяет, что стена сама
        /// видна, а тайл сразу за ней — нет. Обратный результат означал бы, что
        /// луч останавливается на такт раньше или позже, чем нужно.
        /// </summary>
        private static string LineOfSightCheck(GameObject host)
        {
            return LineOfSightCheck(host, out _);
        }

        private static string LineOfSightCheck(GameObject host, out bool passed)
        {
            var fog = host.AddComponent<RoaFogOfWar>();

            var location = new LocationDefinition
            {
                Id = "probe",
                Map = new MapDefinition { Width = 32, Depth = 32, Origin = "center" },
                Objects = new List<LocationObject>()
            };

            // Стена в трёх тайлах прямо перед наблюдателем, поперёк луча.
            for (int i = -1; i <= 1; i++)
            {
                Vector3 world = RoaCoords.TileToWorld(16 + i, 19, 32, 32);
                float serverX;
                float serverZ;
                RoaCoords.ToServer(world, out serverX, out serverZ);

                location.Objects.Add(new LocationObject
                {
                    Id = "wall_" + i,
                    Model = "wallBrickBlock",
                    Position = new Vec3 { X = serverX, Y = 0f, Z = serverZ },
                    Tags = new List<string>()
                });
            }

            fog.Build(location);
            fog.Perception = 15;

            Vector3 eye = RoaCoords.TileToWorld(16, 16, 32, 32);
            fog.Rebuild(eye, false);

            Vector3 wall = RoaCoords.TileToWorld(16, 19, 32, 32);
            Vector3 behind = RoaCoords.TileToWorld(16, 20, 32, 32);
            Vector3 open = RoaCoords.TileToWorld(19, 16, 32, 32);

            bool wallVisible = fog.IsVisible(wall);
            bool behindVisible = fog.IsVisible(behind);
            bool openVisible = fog.IsVisible(open);

            var text = new StringBuilder();
            text.AppendLine("Линия видимости (наблюдатель в тайле 16,16, стена в ряду z=19):");
            text.AppendLine("  радиус " + fog.Radius + ", видимых тайлов " + fog.VisibleCount);
            text.AppendLine("  сама стена видна: " + wallVisible + " (ожидается True)");
            text.AppendLine("  тайл за стеной виден: " + behindVisible + " (ожидается False)");
            text.AppendLine("  открытый тайл сбоку виден: " + openVisible + " (ожидается True)");

            bool overlayOk = true;
            if (Application.isPlaying)
            {
                overlayOk = fog.VisualFogCount > 0 && fog.VisualBlockCount == 3;
                text.AppendLine("  визуальный меш: тёмных " + fog.VisualFogCount
                    + ", стен " + fog.VisualBlockCount + " (ожидается >0/3)");
            }

            passed = wallVisible && !behindVisible && openVisible && overlayOk;
            if (!passed)
                text.AppendLine("  ПРОВАЛ: линия видимости работает не так, как в web-клиенте.");
            else
                text.AppendLine("  Сходится.");

            Object.DestroyImmediate(fog);
            return text.ToString();
        }
    }
}
