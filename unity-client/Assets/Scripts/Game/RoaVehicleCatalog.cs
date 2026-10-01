using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Транспорт на клиенте: какой вид у предмета слота «Транспорт» и как он едет.
    /// Можно ли сесть, скорость и грузоподъёмность решает сервер
    /// (data/kromka/vehicles.json): характеристики приходят вместе с каталогом
    /// предметов (/api/kromka/items → vehicles) и полем vehicle в состоянии игрока.
    ///
    /// Тировые варианты (motorcycleT4) выглядят как исходный предмет группы:
    /// вид берётся по RoaItemData.VisualId.
    /// </summary>
    public static class RoaVehicleCatalog
    {
        public const string Slot = "vehicle";

        // Мотоцикл собран в GLB с узлами седока (tools/blender/build_vehicle_models.py);
        // остальной транспорт — префабы пакета, разметку седока ему даёт RoaVehicleView.
        private static readonly Dictionary<string, string> Models = new Dictionary<string, string>
        {
            { "motorcycle", "/assets/models/vehicles/vehicle_motorcycle.glb" }
        };

        // Группа предметов → вид транспорта. Вид выбирает модель и посадку седока.
        private static readonly Dictionary<string, string> Kinds = new Dictionary<string, string>
        {
            { "moped", "moped" },
            { "motorcycle", "motorcycle" },
            { "pickup", "pickup" },
            { "armyTruck", "truck" }
        };

        /// <summary>Характеристики варианта транспорта из серверного каталога.</summary>
        public struct Stats
        {
            public string ItemId;
            public string Kind;
            public int Tier;
            public float Speed;
            public float Acceleration;
            public float TurnStillDeg;
            public float TurnFullDeg;
            public float ReverseSpeed;
            public float CarryKg;
        }

        /// <summary>
        /// Корпус транспорта в плане (self.vehicle.hull, data/kromka/vehicles.json):
        /// длина и ширина, м, и смещение центра от водителя (OffsetX — вправо,
        /// OffsetZ — вперёд). По нему сталкивается машина, а не капсула водителя.
        /// Сервер проверяет цепочку вписанных кругов, клиент — сам прямоугольник,
        /// поэтому честный клиент упирается раньше сервера и не получает поправок.
        /// </summary>
        public struct Hull
        {
            /// <summary>Низ корпуса над ногами, м: бордюры и ступени берёт капсула водителя.</summary>
            public const float Bottom = 0.35f;
            public const float Height = 1.65f;

            public bool Valid;
            public float Length;
            public float Width;
            public float OffsetX;
            public float OffsetZ;
            /// <summary>Ось поворота от водителя (задний мост машины): вокруг неё разворачивается корпус.</summary>
            public float PivotX;
            public float PivotZ;

            public Vector3 LocalPivot { get { return new Vector3(PivotX, 0f, PivotZ); } }

            public Vector3 Size { get { return new Vector3(Width, Height, Length); } }
            public Vector3 HalfExtents { get { return Size * 0.5f; } }

            /// <summary>Центр корпуса относительно точки на земле под водителем, в осях транспорта.</summary>
            public Vector3 LocalCenter { get { return new Vector3(OffsetX, Bottom + Height * 0.5f, OffsetZ); } }

            public static Hull Parse(JObject hull)
            {
                if (hull == null) return default(Hull);
                float length = hull["length"]?.ToObject<float?>() ?? 0f;
                float width = hull["width"]?.ToObject<float?>() ?? 0f;
                if (!(length > 0.1f) || !(width > 0.1f)) return default(Hull);
                return new Hull
                {
                    Valid = true,
                    Length = Mathf.Min(length, 12f),
                    Width = Mathf.Min(width, 4f),
                    OffsetX = Mathf.Clamp(hull["offsetX"]?.ToObject<float?>() ?? 0f, -6f, 6f),
                    OffsetZ = Mathf.Clamp(hull["offsetZ"]?.ToObject<float?>() ?? 0f, -6f, 6f),
                    PivotX = Mathf.Clamp(hull["pivotX"]?.ToObject<float?>() ?? 0f, -6f, 6f),
                    PivotZ = Mathf.Clamp(hull["pivotZ"]?.ToObject<float?>() ?? 0f, -6f, 6f)
                };
            }
        }

        private static readonly Dictionary<string, Stats> ServerStats = new Dictionary<string, Stats>();

        /// <summary>Принять строки vehicles из /api/kromka/items. Пустой массив ничего не стирает.</summary>
        public static void Apply(JArray vehicles)
        {
            if (vehicles == null || vehicles.Count == 0) return;
            ServerStats.Clear();
            foreach (JToken token in vehicles)
            {
                if (!(token is JObject row)) continue;
                string itemId = row["itemId"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(itemId)) continue;
                ServerStats[itemId] = new Stats
                {
                    ItemId = itemId,
                    Kind = row["kind"]?.ToString() ?? string.Empty,
                    Tier = row["tier"]?.ToObject<int?>() ?? 0,
                    Speed = row["speed"]?.ToObject<float?>() ?? 0f,
                    Acceleration = row["acceleration"]?.ToObject<float?>() ?? 0f,
                    TurnStillDeg = row["turnStillDeg"]?.ToObject<float?>() ?? 0f,
                    TurnFullDeg = row["turnFullDeg"]?.ToObject<float?>() ?? 0f,
                    ReverseSpeed = row["reverseSpeed"]?.ToObject<float?>() ?? 0f,
                    CarryKg = row["carryKg"]?.ToObject<float?>() ?? 0f
                };
            }
        }

        /// <summary>Вид транспорта: moped, motorcycle, pickup, truck; не транспорт — пусто.</summary>
        public static string Kind(string itemId)
        {
            if (string.IsNullOrEmpty(itemId)) return string.Empty;
            string id = RoaInventory.BaseId(itemId);
            if (ServerStats.TryGetValue(id, out Stats stats) && !string.IsNullOrEmpty(stats.Kind)) return stats.Kind;
            if (Kinds.TryGetValue(id, out string kind)) return kind;
            return Kinds.TryGetValue(RoaItemData.VisualId(id), out kind) ? kind : string.Empty;
        }

        public static bool Contains(string itemId)
        {
            return !string.IsNullOrEmpty(Kind(itemId));
        }

        /// <summary>Сидят верхом (мопед, мотоцикл) или в кабине за рулём (пикап, грузовик).</summary>
        public static bool IsCab(string kind)
        {
            return kind == "pickup" || kind == "truck";
        }

        /// <summary>GLB с узлами седока; у транспорта из префабов пакета — пусто.</summary>
        public static string ModelPath(string itemId)
        {
            if (string.IsNullOrEmpty(itemId)) return string.Empty;
            string id = RoaInventory.BaseId(itemId);
            if (Models.TryGetValue(id, out string path)) return path;
            return Models.TryGetValue(RoaItemData.VisualId(id), out path) ? path : string.Empty;
        }

        public static bool TryGetStats(string itemId, out Stats stats)
        {
            return ServerStats.TryGetValue(RoaInventory.BaseId(itemId ?? string.Empty), out stats);
        }

        /// <summary>Сколько килограммов добавляет надетый транспорт (как считает сервер).</summary>
        public static float CarryKg(string itemId)
        {
            return TryGetStats(itemId, out Stats stats) ? stats.CarryKg : 0f;
        }

        /// <summary>Как транспорт называется в подсказках управления.</summary>
        public static string Noun(string kind)
        {
            switch (kind)
            {
                case "moped": return "мопед";
                case "pickup": return "пикап";
                case "truck": return "грузовик";
                default: return "мотоцикл";
            }
        }
    }
}
